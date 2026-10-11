import type { Address } from "viem";
import { chainOrder, type ChainEvent } from "./index.js";

// Funding rows and the principal they imply (EVOLUTION.md section 1.1, ARCHITECTURE.md section 6.1). The indexer
// writes the rows; the worker recomputes each agent's principal from them. Both sides read the kinds from here, so
// the writer and the reader cannot disagree on a name.

/** EntryPoint `AccountDeployed` for a followed account. Written by the indexer's entry point handler. */
export const ACCOUNT_DEPLOYED = "account.deployed";
/** A settlement-asset `Transfer` whose `to` is a followed account. `account` is `to`. */
export const SETTLEMENT_TRANSFER_IN = "settlement.transfer-in";
/** A settlement-asset `Transfer` whose `from` is a followed account. `account` is `from`. */
export const SETTLEMENT_TRANSFER_OUT = "settlement.transfer-out";

/** Who counts for one agent's principal. Every address is compared lowercase. */
export interface FundingParties {
  /** The agent's smart account. */
  account: Address;
  /** The owner wallet on record for the agent (`worker_agents.owner`), the only address whose transfers count. */
  owner: Address;
  /** The configured settlement-asset contract. A row emitted by any other contract never counts. */
  settlementAsset: Address;
}

const lower = (value: unknown) => String(value).toLowerCase();

/**
 * An agent's principal from its indexed rows: a pure fold in chain order (block, log index), so the same rows always
 * give the same value and a replayed or re-indexed block changes nothing.
 *
 * - Nothing counts before the account's `account.deployed` row. With no such row the principal is 0. Funding is made
 *   to a deployed, followed account; a transfer to the counterfactual address before deployment is capital in the
 *   account but not principal, and which of them were indexed would otherwise depend on batch boundaries.
 * - A settlement-asset transfer from the owner to the account adds its value.
 * - A settlement-asset transfer from the account to the owner subtracts its value, with the running total floored at
 *   0: an owner who has taken out at least what they put in has no principal left, and a later deposit starts again
 *   from that deposit.
 * - Everything else changes nothing: trades, x402 payments, reallocation transfers, transfers to or from any third
 *   party, and any row not emitted by `settlementAsset`, whatever the token calls itself.
 */
export function principalFrom(parties: FundingParties, rows: readonly ChainEvent[]): bigint {
  const account = lower(parties.account);
  const owner = lower(parties.owner);
  const asset = lower(parties.settlementAsset);
  let deployed = false;
  let principal = 0n;
  for (const row of [...rows].sort(chainOrder)) {
    if (lower(row.account) !== account) continue;
    if (row.kind === ACCOUNT_DEPLOYED) {
      deployed = true;
      continue;
    }
    if (!deployed || lower(row.address) !== asset) continue;
    const from = lower(row.data.from);
    const to = lower(row.data.to);
    const value = BigInt(String(row.data.value));
    if (row.kind === SETTLEMENT_TRANSFER_IN && from === owner && to === account) principal += value;
    else if (row.kind === SETTLEMENT_TRANSFER_OUT && from === account && to === owner) principal = principal > value ? principal - value : 0n;
  }
  return principal;
}
