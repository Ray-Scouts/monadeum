import {
  X402_EPOCH_SECONDS,
  buildX402Authorization,
  signX402Authorization,
  type SettlementAssetDomain,
  type X402Authorization,
  type X402SigningKey,
} from "@monadeum/wallets";
import { getAddress, isAddressEqual, type Address, type Hex } from "viem";
import type { Payer, PaymentPayload, PaymentTerms } from "./client.js";

/**
 * One claimed nonce slot: the (account, hour, slot) the validator derives the EIP-3009 nonce from, bound to one
 * payment key and to the authorization signed for it. Written before the authorization is signed.
 */
export interface SlotClaim {
  account: Address;
  /** `validAfter / 3600`. */
  epoch: bigint;
  slot: number;
  nonce: Hex;
  paymentKey: string;
  payTo: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  claimedAt: number;
}

/**
 * Durable nonce-slot claims. `claim` inserts only if no claim exists for (account, epoch, slot), and none for the
 * payment key, atomically, and reports whether it did; it is durable before it resolves. A claim is never updated or
 * deleted, so a slot is never reused. `@monadeum/db` provides the Postgres implementation (`x402_nonce_slots`).
 */
export interface X402SlotStore {
  claim(claim: SlotClaim): Promise<boolean>;
  findByPayment(paymentKey: string): Promise<SlotClaim | undefined>;
  findByNonce(account: Address, nonce: Hex): Promise<SlotClaim | undefined>;
}

export class MemoryX402SlotStore implements X402SlotStore {
  private readonly bySlot = new Map<string, SlotClaim>();
  private readonly slotKey = (account: Address, epoch: bigint, slot: number) => `${account.toLowerCase()}:${epoch}:${slot}`;

  async claim(claim: SlotClaim): Promise<boolean> {
    const key = this.slotKey(claim.account, claim.epoch, claim.slot);
    if (this.bySlot.has(key) || (await this.findByPayment(claim.paymentKey))) return false;
    this.bySlot.set(key, { ...claim });
    return true;
  }
  async findByPayment(paymentKey: string) {
    for (const c of this.bySlot.values()) if (c.paymentKey === paymentKey) return { ...c };
    return undefined;
  }
  async findByNonce(account: Address, nonce: Hex) {
    for (const c of this.bySlot.values()) if (isAddressEqual(c.account, account) && c.nonce.toLowerCase() === nonce.toLowerCase()) return { ...c };
    return undefined;
  }
}

export class X402PayerError extends Error {}

/** What the payer needs from WalletsModule: the agent's x402 signing key, null when the agent has none. */
export interface X402KeySource {
  x402SigningKey(agentId: string): Promise<X402SigningKey | null>;
}

export interface ValidatorPayerSettings {
  asset: SettlementAssetDomain;
  /** The same values the validator was installed with (WalletsService's x402 settings). */
  maxValue: bigint;
  paymentsPerEpoch: number;
  maxValidity: number;
  payees: readonly Address[];
  /** The agent a tick belongs to. The tick loop's keys are `${agentId}:${tick}` (`tickKey` in @monadeum/tick). */
  agentOf: (tickKey: string) => string;
  /** Unix seconds. */
  now?: () => bigint;
}

/**
 * The x402 Payer over X402PaymentValidator (ARCHITECTURE.md section 16.3). For each payment it takes the next free
 * nonce slot of the current hour, claims it durably with the payment key, and only then signs a bounded EIP-3009
 * authorization with the agent's x402 key. It fails closed, signing nothing, when the terms are not the configured
 * network, asset, or a listed payee, when the amount exceeds `maxValue`, when the payment key already holds a slot,
 * when every slot of the hour is taken, or when the agent has no active x402 key.
 */
export class ValidatorPayer implements Payer {
  private readonly now: () => bigint;

  constructor(
    private readonly keys: X402KeySource,
    private readonly slots: X402SlotStore,
    private readonly settings: ValidatorPayerSettings,
  ) {
    this.now = settings.now ?? (() => BigInt(Math.floor(Date.now() / 1000)));
  }

  async authorize(request: { key: string; tickKey: string; terms: PaymentTerms }): Promise<PaymentPayload> {
    const { terms } = request;
    const { asset } = this.settings;
    if (terms.scheme !== "exact" || terms.network !== `eip155:${asset.chainId}`) throw new X402PayerError("terms: wrong scheme or network");
    if (!isAddressEqual(getAddress(terms.asset), asset.address)) throw new X402PayerError("terms: wrong asset");
    const payTo = getAddress(terms.payTo);
    if (!this.settings.payees.some((p) => isAddressEqual(p, payTo))) throw new X402PayerError("terms: payee not listed");
    if (terms.amount <= 0n || terms.amount > this.settings.maxValue) throw new X402PayerError("terms: amount over maxValue");

    const key = await this.keys.x402SigningKey(this.settings.agentOf(request.tickKey));
    if (!key) throw new X402PayerError("no active x402 key for this agent");
    // A payment key is signed for at most once, whatever happened after its slot was claimed.
    if (await this.slots.findByPayment(request.key)) throw new X402PayerError("payment already holds a slot");

    const validity = BigInt(Math.min(terms.maxTimeoutSeconds, this.settings.maxValidity));
    const config = {
      signer: key.keyAddress, maxValue: this.settings.maxValue, paymentsPerEpoch: this.settings.paymentsPerEpoch,
      maxValidity: this.settings.maxValidity, payees: this.settings.payees,
    };
    const nowSeconds = this.now();
    let claimed: { authorization: X402Authorization; slot: number } | null = null;
    for (let slot = 0; slot < this.settings.paymentsPerEpoch && !claimed; slot++) {
      const authorization = buildX402Authorization({ account: key.account, payTo, value: terms.amount, nowSeconds, validitySeconds: validity, slot, config });
      const won = await this.slots.claim({
        account: key.account, epoch: authorization.validAfter / X402_EPOCH_SECONDS, slot, nonce: authorization.nonce, paymentKey: request.key,
        payTo, value: terms.amount, validAfter: authorization.validAfter, validBefore: authorization.validBefore, claimedAt: Number(nowSeconds),
      });
      if (won) claimed = { authorization, slot };
      else if (await this.slots.findByPayment(request.key)) throw new X402PayerError("payment already holds a slot");
    }
    if (!claimed) throw new X402PayerError("every nonce slot of this hour is taken");

    const { authorization, slot } = claimed;
    const signature = await signX402Authorization({ key: { address: key.keyAddress, sign: key.sign }, validator: key.validator, asset, authorization, slot });
    return {
      x402Version: 2,
      ...(terms.resource ? { resource: terms.resource } : {}),
      accepted: terms.requirement,
      payload: {
        signature,
        authorization: {
          from: authorization.from,
          to: authorization.to,
          value: authorization.value.toString(),
          validAfter: authorization.validAfter.toString(),
          validBefore: authorization.validBefore.toString(),
          nonce: authorization.nonce,
        },
      },
    };
  }
}
