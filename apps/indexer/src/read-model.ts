import type { Address, Hex } from "viem";
import type { ReadModelStore } from "./store.js";
import type { ChainEvent } from "./types.js";

export interface SessionPermissionView {
  permissionId: Hex;
  installedNonce: number;
  installedBlock: bigint;
  uninstalled: boolean;
  /**
   * Installed, not uninstalled since, and not below the latest invalidated nonce. Derived from indexed events only:
   * the authoritative revocation check reads the account's state directly (`WalletsService.revocationStatus`).
   */
  live: boolean;
}

/** What the chain says about one agent account, as of the indexer's cursor. */
export interface AccountView {
  account: Address;
  deployment: { factory: Address; paymaster: Address; transactionHash: Hex; blockNumber: bigint } | null;
  limits: { perTxCap: bigint; dailyCap: bigint } | null;
  allowed: { target: Address; selector: Hex }[];
  /**
   * The most recent `Spent` event. `windowTotal` is the rolling 24-hour total at that event, not now: the window keeps
   * moving without events, so the current total is read from the contract (`windowTotal`) when it matters.
   */
  lastSpent: { amount: bigint; windowTotal: bigint; blockNumber: bigint } | null;
  totalSpent: bigint;
  invalidatedNonce: number | null;
  permissions: SessionPermissionView[];
}

/** Folds an account's rows, in chain order, into its current view. Pure, so a reorg only needs the rows rewritten. */
export function projectAccount(account: Address, rows: readonly ChainEvent[]): AccountView {
  const view: AccountView = {
    account: account.toLowerCase() as Address,
    deployment: null,
    limits: null,
    allowed: [],
    lastSpent: null,
    totalSpent: 0n,
    invalidatedNonce: null,
    permissions: [],
  };
  const allowed = new Map<string, { target: Address; selector: Hex }>();
  const permissions = new Map<string, SessionPermissionView>();
  for (const row of rows) {
    if (row.account !== view.account) continue;
    const d = row.data;
    switch (row.kind) {
      case "account.deployed":
        view.deployment = { factory: d.factory as Address, paymaster: d.paymaster as Address, transactionHash: row.transactionHash, blockNumber: row.blockNumber };
        break;
      case "spend.limits-set":
        view.limits = { perTxCap: BigInt(d.perTxCap as string), dailyCap: BigInt(d.dailyCap as string) };
        break;
      case "spend.call-allowed": {
        const key = `${d.target}:${d.selector}`;
        if (d.allowed) allowed.set(key, { target: d.target as Address, selector: d.selector as Hex });
        else allowed.delete(key);
        break;
      }
      case "spend.spent":
        view.lastSpent = { amount: BigInt(d.amount as string), windowTotal: BigInt(d.windowTotal as string), blockNumber: row.blockNumber };
        view.totalSpent += BigInt(d.amount as string);
        break;
      case "kernel.permission-installed":
        permissions.set(d.permissionId as string, {
          permissionId: d.permissionId as Hex,
          installedNonce: d.nonce as number,
          installedBlock: row.blockNumber,
          uninstalled: false,
          live: false,
        });
        break;
      case "kernel.permission-uninstalled": {
        const p = permissions.get(d.permissionId as string);
        if (p) p.uninstalled = true;
        break;
      }
      case "kernel.nonce-invalidated":
        view.invalidatedNonce = d.nonce as number;
        break;
    }
  }
  view.allowed = [...allowed.values()];
  view.permissions = [...permissions.values()].map((p) => ({
    ...p,
    live: !p.uninstalled && (view.invalidatedNonce === null || p.installedNonce >= view.invalidatedNonce),
  }));
  return view;
}

export async function accountView(store: ReadModelStore, account: Address): Promise<AccountView> {
  return projectAccount(account, await store.events({ account }));
}
