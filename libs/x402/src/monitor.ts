import { decodeEventLog, getAddress, isAddressEqual, parseAbi, type Address, type Hex } from "viem";
import type { PaymentLog } from "./client.js";
import type { X402SlotStore } from "./payer.js";

// Settlement monitoring (SECURITY.md section 12): every on-chain x402 settlement from an agent account must match a
// payment the platform's own client logged. A settlement nobody logged means the x402 key signed outside the client,
// which is the signal a stolen key would produce. The check is a pure function over observed logs and the two
// stores, so the indexer (which already follows the chain) or the worker can run it.

/** FiatToken v2.2 (USDC) events, FACT from the deployed contract's ABI: EIP-3009 emits AuthorizationUsed. */
export const settlementEventsAbi = parseAbi([
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export interface ChainLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  transactionHash: Hex;
  blockNumber: bigint;
  logIndex: number;
}

/** One `transferWithAuthorization` settlement seen on chain: the authorization used and the transfer it made. */
export interface ObservedSettlement {
  authorizer: Address;
  nonce: Hex;
  /** From the Transfer event that follows AuthorizationUsed in the same transaction; null when none was found. */
  to: Address | null;
  value: bigint | null;
  transactionHash: Hex;
  blockNumber: bigint;
}

export type SettlementAlert =
  | { type: "x402-settlement-unmatched"; settlement: ObservedSettlement }
  | { type: "x402-settlement-mismatch"; settlement: ObservedSettlement; paymentKey: string; reason: string };

/**
 * Settlements by `accounts` in `logs` of the settlement asset. Each AuthorizationUsed is paired with the next Transfer
 * from the same authorizer in the same transaction, which is the order FiatToken emits them in
 * `transferWithAuthorization` (AuthorizationUsed, then Transfer). Logs of other contracts are ignored.
 */
export function settlementsFromLogs(logs: readonly ChainLog[], asset: Address, accounts: readonly Address[]): ObservedSettlement[] {
  const ours = (a: Address) => accounts.some((x) => isAddressEqual(x, a));
  const sorted = logs.filter((l) => isAddressEqual(l.address, asset)).sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1);
  const decoded = sorted.map((l) => {
    try {
      return { log: l, event: decodeEventLog({ abi: settlementEventsAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] }) };
    } catch {
      return null;
    }
  });
  const out: ObservedSettlement[] = [];
  decoded.forEach((d, i) => {
    if (!d || d.event.eventName !== "AuthorizationUsed" || !ours(d.event.args.authorizer)) return;
    const authorizer = getAddress(d.event.args.authorizer);
    let to: Address | null = null;
    let value: bigint | null = null;
    for (const next of decoded.slice(i + 1)) {
      if (!next || next.log.transactionHash !== d.log.transactionHash) continue;
      if (next.event.eventName === "AuthorizationUsed") break;
      if (next.event.eventName === "Transfer" && isAddressEqual(next.event.args.from, authorizer)) {
        to = getAddress(next.event.args.to);
        value = next.event.args.value;
        break;
      }
    }
    out.push({ authorizer, nonce: d.event.args.nonce, to, value, transactionHash: d.log.transactionHash, blockNumber: d.log.blockNumber });
  });
  return out;
}

/**
 * Matches each settlement to the slot claimed for its nonce and to that payment's log entry. Returns an alert for a
 * settlement with no claim (`x402-settlement-unmatched`), and for one whose payee, amount, logged price, or logged
 * settlement transaction differs from what was claimed and logged (`x402-settlement-mismatch`). Both are alerted on
 * immediately (SECURITY.md section 12). A matched settlement the client has not yet recorded (no settlement
 * reference in the log) is not an alert: the facilitator may settle before the paid response arrives.
 */
export async function reconcileSettlements(
  settlements: readonly ObservedSettlement[],
  stores: { slots: X402SlotStore; log: PaymentLog },
): Promise<SettlementAlert[]> {
  const alerts: SettlementAlert[] = [];
  for (const settlement of settlements) {
    const claim = await stores.slots.findByNonce(settlement.authorizer, settlement.nonce);
    if (!claim) {
      alerts.push({ type: "x402-settlement-unmatched", settlement });
      continue;
    }
    const mismatch = (reason: string) => alerts.push({ type: "x402-settlement-mismatch", settlement, paymentKey: claim.paymentKey, reason });
    const entry = await stores.log.get(claim.paymentKey);
    if (!entry) mismatch("no payment log entry for the claimed slot");
    else if (settlement.to === null || settlement.value === null) mismatch("no transfer found for the authorization");
    else if (!isAddressEqual(settlement.to, claim.payTo)) mismatch("paid another address than the claimed payee");
    else if (settlement.value !== claim.value || settlement.value !== entry.price) mismatch("paid another amount than claimed and logged");
    else if (entry.settlementRef !== null && entry.settlementRef.toLowerCase() !== settlement.transactionHash.toLowerCase()) {
      mismatch("logged settlement transaction differs");
    }
  }
  return alerts;
}
