import type { AllowedCall } from "@monadeum/risk";
import { getAddress, isAddress, isAddressEqual, isHex, toFunctionSelector, type Address, type Hex } from "viem";

// The session key scope is the call allowlist of SECURITY.md section 1 and ARCHITECTURE.md section 16.3: Kuru's
// router, the owner-scoped reallocation contract, `transfer` and `approve` on the settlement asset, and `approve` on
// each traded asset (the ERC-20 base a close sells), nothing else. The x402 facilitator is not a call target (16.3, x402 signature path), so it is not in scope.
// The reallocation entry carries the allowlist label "reallocation" (ARCHITECTURE.md sections 16.1 and 16.5). Its only
// selector in production is AgentReallocation's `reallocate`, so the session key cannot reach the contract's owner or
// operator functions.

export const TRANSFER_SELECTOR = toFunctionSelector("transfer(address,uint256)");
export const APPROVE_SELECTOR = toFunctionSelector("approve(address,uint256)");

/** The allowlisted contracts. Router and reallocation selectors are configuration until their interfaces settle. */
export interface ScopeTargets {
  settlementAsset: Address;
  kuruRouter: Address;
  kuruRouterSelectors: readonly Hex[];
  reallocation: Address;
  reallocationSelectors: readonly Hex[];
  /**
   * The ERC-20 bases the agent sells to close a position (WETH for the default WETH/USDC market). Each gets exactly
   * `approve`, labeled "traded-asset", and is marked on the spend policy with `setTradedAsset` before it is allowed,
   * so its approve is held to the recipient rule on-chain and counts 0 (ARCHITECTURE.md section 16.3).
   */
  tradedAssets?: readonly Address[];
}

export class ScopeError extends Error {}

function selector(value: Hex, where: string): Hex {
  if (!isHex(value) || value.length !== 10) throw new ScopeError(`${where}: selector ${value} is not 4 bytes`);
  return value.toLowerCase() as Hex;
}

/**
 * Builds the exact allowlist. Rejects an empty selector list, a duplicate entry, and any two labels sharing an
 * address, so a misconfiguration cannot widen the scope by aliasing one target under another label.
 */
export function buildScope(targets: ScopeTargets): readonly AllowedCall[] {
  const traded = targets.tradedAssets ?? [];
  const addresses: [string, Address][] = [
    ["settlement", targets.settlementAsset], ["router", targets.kuruRouter], ["reallocation", targets.reallocation],
    ...traded.map((t, i) => [`traded asset ${i}`, t] as [string, Address]),
  ];
  for (const [name, value] of addresses) {
    if (!isAddress(value) || BigInt(value) === 0n) throw new ScopeError(`${name}: not a nonzero address`);
  }
  const distinct = new Set(addresses.map(([, a]) => a.toLowerCase()));
  if (distinct.size !== addresses.length) {
    throw new ScopeError("settlement asset, Kuru router, reallocation contract and traded assets must be distinct");
  }
  if (targets.kuruRouterSelectors.length === 0) throw new ScopeError("kuru router: no selectors configured");
  if (targets.reallocationSelectors.length === 0) throw new ScopeError("reallocation: no selectors configured");

  const scope: AllowedCall[] = [
    { target: getAddress(targets.settlementAsset), selector: TRANSFER_SELECTOR, label: "settlement-asset" },
    { target: getAddress(targets.settlementAsset), selector: APPROVE_SELECTOR, label: "settlement-asset" },
    ...targets.kuruRouterSelectors.map((s) => ({ target: getAddress(targets.kuruRouter), selector: selector(s, "kuru router"), label: "kuru-router" as const })),
    ...targets.reallocationSelectors.map((s) => ({ target: getAddress(targets.reallocation), selector: selector(s, "reallocation"), label: "reallocation" as const })),
    ...traded.map((t) => ({ target: getAddress(t), selector: APPROVE_SELECTOR, label: "traded-asset" as const })),
  ];
  const keys = new Set(scope.map((c) => `${c.target.toLowerCase()}:${c.selector.toLowerCase()}`));
  if (keys.size !== scope.length) throw new ScopeError("duplicate allowlist entry");
  return Object.freeze(scope.map((c) => Object.freeze(c)));
}

/** The distinct traded-asset targets of a scope, in order. */
export function tradedAssetsOf(scope: readonly AllowedCall[]): Address[] {
  const seen = new Map<string, Address>();
  for (const c of scope) if (c.label === "traded-asset") seen.set(c.target.toLowerCase(), c.target);
  return [...seen.values()];
}

export interface Call {
  to: Address;
  value: bigint;
  data: Hex;
}

/**
 * True only if every call names an allowlisted (target, selector) and carries no native value. This mirrors the
 * on-chain check so the module never signs an operation the account would reject; it is not the enforcement point.
 */
export function callsInScope(scope: readonly AllowedCall[], calls: readonly Call[]): boolean {
  if (calls.length === 0) return false;
  return calls.every((call) => {
    if (call.value !== 0n || !isHex(call.data) || call.data.length < 10) return false;
    const sel = call.data.slice(0, 10).toLowerCase();
    return scope.some((c) => isAddressEqual(c.target, call.to) && c.selector.toLowerCase() === sel);
  });
}
