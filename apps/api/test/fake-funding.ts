import { getAddress, isAddressEqual, keccak256, recoverTypedDataAddress, toHex, type Address, type Hex } from "viem";
import { fundingTypedData, type AssetDomain, type FundingAuthorization, type FundingChain, type PreparedRelay, type RelayReceipt } from "../src/index.js";

export const FUNDING_ASSET = getAddress("0x534b2f3A21130d7a60830c2Df862319e593943A3");

/**
 * The chain side of funding, in memory: a USDC with EIP-3009 `transferWithAuthorization` semantics (the signature must
 * recover `from` over the token's domain, the nonce is accepted once per `from`, the clock must be inside the window,
 * and `from` must hold the value), the relayer's MON balance, and account code read from WalletsModule's test chain.
 */
export class FakeFundingChain implements FundingChain {
  readonly chainId = 10143;
  readonly asset = FUNDING_ASSET;
  readonly balances = new Map<string, bigint>();
  readonly used = new Set<string>();
  readonly sent: { hash: Hex; authorization: FundingAuthorization }[] = [];
  private readonly receipts = new Map<string, RelayReceipt>();
  relayerWei = 10n ** 18n;
  gasPrice = 100_000_000_000n;
  /** When set, `send` throws after (or instead of) broadcasting. */
  sendMode: "ok" | "lost-response" | "dropped" = "ok";
  private block = 5000n;
  private count = 0;

  constructor(
    readonly relayer: Address,
    private readonly code: (account: Address) => Promise<boolean>,
    private readonly nowSeconds: () => bigint,
  ) {}

  domain(): AssetDomain {
    return { name: "USDC", version: "2", chainId: this.chainId, verifyingContract: this.asset, decimals: 6 };
  }

  async assetDomain() {
    return this.domain();
  }

  async balanceOf(owner: Address) {
    return this.balances.get(owner.toLowerCase()) ?? 0n;
  }

  fund(owner: Address, value: bigint) {
    this.balances.set(owner.toLowerCase(), (this.balances.get(owner.toLowerCase()) ?? 0n) + value);
  }

  async authorizationUsed(authorizer: Address, nonce: Hex) {
    return this.used.has(`${authorizer.toLowerCase()}:${nonce.toLowerCase()}`);
  }

  hasCode(account: Address) {
    return this.code(account);
  }

  async nativeBalance(address: Address) {
    return isAddressEqual(address, this.relayer) ? this.relayerWei : 0n;
  }

  private async check(a: FundingAuthorization, signature: Hex) {
    const signer = await recoverTypedDataAddress({ ...fundingTypedData(this.domain(), a), signature });
    if (!isAddressEqual(signer, a.from)) throw new Error("FiatTokenV2: invalid signature");
    if (await this.authorizationUsed(a.from, a.nonce)) throw new Error("FiatTokenV2: authorization is used or canceled");
    const now = this.nowSeconds();
    if (now <= a.validAfter) throw new Error("FiatTokenV2: authorization is not yet valid");
    if (now >= a.validBefore) throw new Error("FiatTokenV2: authorization is expired");
    if ((await this.balanceOf(a.from)) < a.value) throw new Error("ERC20: transfer amount exceeds balance");
  }

  async prepareRelay(a: FundingAuthorization, signature: Hex): Promise<PreparedRelay> {
    await this.check(a, signature);
    const hash = keccak256(toHex(`relay-${a.nonce}-${this.count++}`));
    const gas = 80_000n;
    return {
      hash,
      maxCost: gas * this.gasPrice,
      send: async () => {
        if (this.sendMode === "dropped") throw new Error("connection reset");
        await this.check(a, signature);
        this.used.add(`${a.from.toLowerCase()}:${a.nonce.toLowerCase()}`);
        this.balances.set(a.from.toLowerCase(), (await this.balanceOf(a.from)) - a.value);
        this.fund(a.to, a.value);
        this.relayerWei -= gas * this.gasPrice;
        this.receipts.set(hash.toLowerCase(), { status: "success", blockNumber: ++this.block });
        this.sent.push({ hash, authorization: { ...a } });
        if (this.sendMode === "lost-response") throw new Error("timeout");
      },
    };
  }

  async receipt(hash: Hex) {
    return this.receipts.get(hash.toLowerCase()) ?? null;
  }
}
