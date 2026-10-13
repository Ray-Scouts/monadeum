import { ApiError } from "./client";

/**
 * Shared rules for showing a failure to an owner. A message names what happened and what to do next; it never prints
 * a raw error string, a stack, or a hex dump. A short, readable server detail may follow in parentheses, and anything
 * else is dropped, because the sentence around it already says what the owner can do.
 */

const HEX_RUN = /0x[0-9a-fA-F]{16,}/;

/** The detail when it is short, readable text with no hex run, otherwise null. */
export function safeDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const d = detail.trim();
  if (!d || d.length > 80 || HEX_RUN.test(d) || /[\n\r]/.test(d)) return null;
  return d;
}

/** ` (detail)` for a safe detail, or an empty string. */
export const detailSuffix = (detail: string | null | undefined): string => {
  const d = safeDetail(detail);
  return d ? ` (${d})` : "";
};

/** A thrown value that is not an `ApiError`, in plain language. A long or hex-laden message is replaced by `fallback`. */
export function plainThrown(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return fallback;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return safeDetail(message) ?? fallback;
}
