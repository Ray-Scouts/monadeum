import type { AllowedCall } from "@monadeum/risk";
import { getAddress, isAddress, isAddressEqual, isHex, toFunctionSelector, type Address, type Hex } from "viem";

// The session key scope is the call allowlist of SECURITY.md section 1 and ARCHITECTURE.md section 16.3: Kuru's
// router, the owner-scoped reallocation contract, and `transfer` and `approve` on the settlement asset, nothing
// else. The x402 facilitator is not a call target (16.3, x402 signature path), so it is not in scope.
// The reallocation entry keeps the allowlist label "reproduction", as ARCHITECTURE.md section 16.1 does until
// issue #31 renames it.

export const TRANSFER_SELECTOR = toFunctionSelector("transfer(address,uint256)");
export const APPROVE_SELECTOR = toFunctionSelector("approve(address,uint256)");

/** The three allowlisted contracts. Router and reallocation selectors are configuration until their interfaces settle. */
export interface ScopeTargets {
  settlementAsset: Address;
  kuruRouter: Address;
  kuruRouterSelectors: readonly Hex[];
  reallocation: Address;
  reallocationSelectors: readonly Hex[];
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
  const addresses = { settlement: targets.settlementAsset, router: targets.kuruRouter, reallocation: targets.reallocation };
  for (const [name, value] of Object.entries(addresses)) {
    if (!isAddress(value) || BigInt(value) === 0n) throw new ScopeError(`${name}: not a nonzero address`);
  }
  const distinct = new Set(Object.values(addresses).map((a) => a.toLowerCase()));
  if (distinct.size !== 3) throw new ScopeError("settlement asset, Kuru router and reallocation contract must be distinct");
  if (targets.kuruRouterSelectors.length === 0) throw new ScopeError("kuru router: no selectors configured");
  if (targets.reallocationSelectors.length === 0) throw new ScopeError("reallocation: no selectors configured");

  const scope: AllowedCall[] = [
    { target: getAddress(targets.settlementAsset), selector: TRANSFER_SELECTOR, label: "settlement-asset" },
    { target: getAddress(targets.settlementAsset), selector: APPROVE_SELECTOR, label: "settlement-asset" },
    ...targets.kuruRouterSelectors.map((s) => ({ target: getAddress(targets.kuruRouter), selector: selector(s, "kuru router"), label: "kuru-router" as const })),
    ...targets.reallocationSelectors.map((s) => ({ target: getAddress(targets.reallocation), selector: selector(s, "reallocation"), label: "reproduction" as const })),
  ];
  const keys = new Set(scope.map((c) => `${c.target.toLowerCase()}:${c.selector.toLowerCase()}`));
  if (keys.size !== scope.length) throw new ScopeError("duplicate allowlist entry");
  return Object.freeze(scope.map((c) => Object.freeze(c)));
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
