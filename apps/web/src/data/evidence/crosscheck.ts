import type { CrossCheckField } from "./types";

/** Envio's HyperSync documentation, linked from the card. */
export const ENVIO_DOCS_URL = "https://docs.envio.dev/docs/HyperSync/overview";

/** A match or mismatch older than this is shown as unverified, so an old result never reads as current. */
export const CROSSCHECK_MAX_AGE_MS = 15 * 60_000;

/** What the card shows. Only `match` is green, and only a well-formed, consistent, recent result is a match. */
export type CrossCheckView =
  | { state: "absent" }
  | {
      state: "match" | "mismatch" | "unverified";
      /** Why the state is unverified, in words; null otherwise. */
      reason: string | null;
      range: { from: string; to: string } | null;
      counts: { indexer: number; hypersync: number } | null;
      matched: number | null;
      missing: { inHyperSync: number; inIndexer: number } | null;
      fieldMismatches: number | null;
      height: string | null;
      checkedAt: number | null;
    };

const REASONS: Record<string, string> = {
  pending: "The first comparison has not finished yet.",
  stale: "The last comparison is too old to rely on.",
  lagging: "HyperSync has not yet indexed up to the end of the range.",
  "no-cursor": "The indexer has not stored a block yet.",
  range: "The block range could not be compared.",
  "too-large": "The range returned more logs than one comparison accepts.",
  timeout: "The comparison did not finish in time.",
  unavailable: "HyperSync could not be reached, or answered with an error.",
};

const unverified = (reason: string): Exclude<CrossCheckView, { state: "absent" }> => ({ state: "unverified", reason, range: null, counts: null, matched: null, missing: null, fieldMismatches: null, height: null, checkedAt: null });

const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const block = (v: unknown): v is string => typeof v === "string" && /^\d{1,20}$/.test(v);

/**
 * Reads the `crossCheck` field fail closed. A missing field is `absent` (the feature is off on that server). A field
 * of any other shape, a different source, an inconsistent count, a `match` with no completion time, or a result older
 * than `CROSSCHECK_MAX_AGE_MS` is `unverified`: nothing is shown green on the strength of data this page cannot make
 * sense of.
 */
export function parseCrossCheck(raw: unknown, now: number): CrossCheckView {
  if (raw === undefined) return { state: "absent" };
  if (typeof raw !== "object" || raw === null) return unverified("The cross-check field has an unexpected shape.");
  const f = raw as Partial<CrossCheckField>;
  const shapeOk =
    f.source === "envio-hypersync" &&
    (f.status === "match" || f.status === "mismatch" || f.status === "unverified") &&
    (f.range === null || (typeof f.range === "object" && block(f.range.from) && block(f.range.to))) &&
    typeof f.counts === "object" && f.counts !== null && count(f.counts.indexer) && count(f.counts.hypersync) &&
    count(f.matched) &&
    typeof f.missing === "object" && f.missing !== null && count(f.missing.inHyperSync) && count(f.missing.inIndexer) &&
    count(f.fieldMismatches) &&
    (f.hypersyncHeight === null || block(f.hypersyncHeight)) &&
    (f.checkedAt === null || (typeof f.checkedAt === "string" && !Number.isNaN(Date.parse(f.checkedAt))));
  if (!shapeOk) return unverified("The cross-check field has an unexpected shape.");
  const v = f as CrossCheckField;
  const checkedAt = v.checkedAt === null ? null : Date.parse(v.checkedAt);
  const numbers = { range: v.range, counts: v.counts, matched: v.matched, missing: v.missing, fieldMismatches: v.fieldMismatches, height: v.hypersyncHeight, checkedAt };

  if (v.status === "unverified") {
    const known = v.reason !== undefined ? REASONS[v.reason] : undefined;
    const reason = known ?? "The comparison could not be made.";
    // With no range there was no comparison, so the zero counts of the server's placeholder are not shown as counts.
    return v.range === null ? { ...unverified(reason), height: v.hypersyncHeight, checkedAt } : { state: "unverified", reason, ...numbers };
  }
  if (checkedAt === null || v.range === null) return { state: "unverified", reason: "The result carries no completion time or range.", ...numbers };
  if (now - checkedAt > CROSSCHECK_MAX_AGE_MS) return { state: "unverified", reason: "The last comparison is older than 15 minutes.", ...numbers };
  const differences = v.missing.inHyperSync + v.missing.inIndexer + v.fieldMismatches;
  if (v.status === "match") {
    const consistent = differences === 0 && v.matched === v.counts.indexer && v.matched === v.counts.hypersync;
    return consistent ? { state: "match", reason: null, ...numbers } : { state: "unverified", reason: "The reported counts do not agree with a match.", ...numbers };
  }
  return differences > 0 ? { state: "mismatch", reason: null, ...numbers } : { state: "unverified", reason: "A mismatch was reported with no difference counted.", ...numbers };
}
