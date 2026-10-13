import type { Evidence } from "./types";

/** Reads the public evidence document. No credential is sent: the endpoint is public and read-only. */
export async function fetchEvidence(apiUrl: string, fetchImpl: typeof fetch = fetch): Promise<Evidence> {
  const res = await fetchImpl(`${apiUrl}/public/evidence`, { method: "GET", credentials: "omit", headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(res.status === 429 ? "The evidence endpoint is rate limited. Try again in a minute." : `The evidence endpoint answered ${res.status}.`);
  const body: unknown = await res.json();
  if (!isEvidence(body)) throw new Error("The evidence endpoint answered with a document of an unexpected shape.");
  return body;
}

const isCategory = (v: unknown): boolean => typeof v === "object" && v !== null && typeof (v as { count: unknown }).count === "number" && Array.isArray((v as { items: unknown }).items);

/** A document is used only when every category is present with a count and a list; anything else is refused, not partly shown. */
export function isEvidence(v: unknown): v is Evidence {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Partial<Evidence>;
  return (
    typeof e.generatedAt === "string" &&
    !Number.isNaN(Date.parse(e.generatedAt)) &&
    typeof e.events === "object" &&
    e.events !== null &&
    isCategory(e.events.deployed) &&
    isCategory(e.events.limitsSet) &&
    isCategory(e.events.callAllowed) &&
    isCategory(e.events.spent) &&
    isCategory(e.trades) &&
    isCategory(e.payments)
  );
}
