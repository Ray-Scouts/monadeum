import { describe, expect, test } from "bun:test";
import { parseCrossCheck } from "./crosscheck";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");

const good = {
  source: "envio-hypersync",
  status: "match",
  range: { from: "100", to: "200" },
  counts: { indexer: 3, hypersync: 3 },
  matched: 3,
  missing: { inHyperSync: 0, inIndexer: 0 },
  fieldMismatches: 0,
  hypersyncHeight: "205",
  checkedAt: "2026-10-13T11:59:30.000Z",
};

describe("parseCrossCheck fails closed", () => {
  test("a missing field means the feature is off on that server", () => {
    expect(parseCrossCheck(undefined, NOW)).toEqual({ state: "absent" });
  });

  test("a consistent, recent match is the only green state", () => {
    const v = parseCrossCheck(good, NOW);
    expect(v.state).toBe("match");
    if (v.state === "match") expect(v.counts).toEqual({ indexer: 3, hypersync: 3 });
  });

  test("a match whose counts disagree, or that has no completion time, is unverified", () => {
    expect(parseCrossCheck({ ...good, matched: 2 }, NOW).state).toBe("unverified");
    expect(parseCrossCheck({ ...good, counts: { indexer: 3, hypersync: 4 } }, NOW).state).toBe("unverified");
    expect(parseCrossCheck({ ...good, missing: { inHyperSync: 1, inIndexer: 0 } }, NOW).state).toBe("unverified");
    expect(parseCrossCheck({ ...good, checkedAt: null }, NOW).state).toBe("unverified");
    expect(parseCrossCheck({ ...good, range: null }, NOW).state).toBe("unverified");
  });

  test("a result older than 15 minutes is unverified", () => {
    expect(parseCrossCheck(good, NOW + 16 * 60_000).state).toBe("unverified");
  });

  test("a different source, a wrong type, or a field that is not an object is unverified, never a match", () => {
    for (const bad of [{ ...good, source: "other" }, { ...good, status: "ok" }, { ...good, counts: "3" }, { ...good, matched: -1 }, { ...good, hypersyncHeight: 205 }, { ...good, checkedAt: "yesterday" }, "match", null, 7]) {
      expect(parseCrossCheck(bad, NOW).state).toBe("unverified");
    }
  });

  test("a mismatch needs a counted difference, and shows as a mismatch", () => {
    expect(parseCrossCheck({ ...good, status: "mismatch" }, NOW).state).toBe("unverified");
    expect(parseCrossCheck({ ...good, status: "mismatch", fieldMismatches: 1 }, NOW).state).toBe("mismatch");
  });

  test("unverified keeps a readable reason and does not show placeholder counts when nothing was compared", () => {
    const pending = parseCrossCheck({ ...good, status: "unverified", reason: "pending", range: null, counts: { indexer: 0, hypersync: 0 }, matched: 0, hypersyncHeight: null, checkedAt: null }, NOW);
    expect(pending.state).toBe("unverified");
    if (pending.state === "unverified") {
      expect(pending.reason).toContain("not finished");
      expect(pending.counts).toBeNull();
    }
    const unknown = parseCrossCheck({ ...good, status: "unverified", reason: "<script>" }, NOW);
    if (unknown.state === "unverified") expect(unknown.reason).toBe("The comparison could not be made.");
  });
});
