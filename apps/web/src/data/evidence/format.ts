import { formatUnits } from "viem";

/** Settlement asset (testnet USDC) has 6 decimals in the deployment record. */
export const SETTLEMENT_DECIMALS = 6;
/** The testnet market's base token is an 18-decimal token (WMON), as `monad-testnet-wmon-market.json` records it. */
export const BASE_DECIMALS = 18;

/** `formatUnits` for a decimal string, trimmed of trailing zeros, never throwing on a bad value (it is shown as received). */
export function units(value: string, decimals: number): string {
  if (!/^-?\d+$/.test(value)) return value;
  const out = formatUnits(BigInt(value), decimals);
  return out.includes(".") ? out.replace(/0+$/, "").replace(/\.$/, "") : out;
}

export const usdc = (value: string) => `${units(value, SETTLEMENT_DECIMALS)} USDC`;

/** `2026-10-12 14:03:11 UTC`, for a timestamp, deterministic across server and browser. */
export function utc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** `12 s ago`, `3 min ago`, `1 h ago`. */
export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}
