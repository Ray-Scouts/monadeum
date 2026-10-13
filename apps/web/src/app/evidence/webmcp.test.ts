import { describe, expect, test } from "bun:test";
import type { Evidence } from "@/data/evidence/types";
import type { ChainReader } from "@/data/evidence/verify";
import { evidenceTools, registerEvidenceTools, type ModelContextLike } from "./webmcp";

const empty = { count: 0, items: [] };
const evidence: Evidence = {
  generatedAt: "2026-10-12T12:00:00.000Z",
  chainId: 10143,
  indexedThrough: null,
  events: { deployed: { count: 2, items: [] }, limitsSet: empty, callAllowed: empty, spent: empty },
  reallocations: { moved: empty, retired: empty, evaluationsAdvanced: empty },
  trades: empty,
  payments: empty,
};
const HASH = `0x${"ab".repeat(32)}`;

const reader = (receipt: Awaited<ReturnType<ChainReader["receipt"]>> | "throw"): ChainReader => ({
  chainId: async () => 10143,
  receipt: async () => {
    if (receipt === "throw") throw new Error("rpc down");
    return receipt;
  },
  codeSize: async () => 0,
  read: async () => 0n,
});

describe("webmcp tools", () => {
  test("only read-only tools are defined, and none has a signing or sending name", () => {
    const tools = evidenceTools({ evidence: () => evidence, reader: () => reader(null) });
    expect(tools.map((t) => t.name)).toEqual(["get_evidence_summary", "verify_transaction"]);
    for (const t of tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.name).not.toMatch(/sign|send|create|fund|activate|stop|transfer/);
    }
  });

  test("the summary reports the document's counts, or says it has none", async () => {
    const [summary] = evidenceTools({ evidence: () => evidence, reader: () => reader(null) });
    const out = (await summary!.execute({})) as { available: boolean; counts: { accountDeployments: number } };
    expect(out.available).toBe(true);
    expect(out.counts.accountDeployments).toBe(2);
    const [none] = evidenceTools({ evidence: () => null, reader: () => reader(null) });
    expect(((await none!.execute({})) as { available: boolean }).available).toBe(false);
  });

  test("verification fails closed: malformed hash, missing receipt, rpc error, reverted", async () => {
    const run = async (r: ChainReader, input: Record<string, unknown>) => {
      const [, verify] = evidenceTools({ evidence: () => null, reader: () => r });
      return (await verify!.execute(input)) as { state: string };
    };
    expect((await run(reader(null), { transactionHash: "0x12" })).state).toBe("unverified");
    expect((await run(reader(null), {})).state).toBe("unverified");
    expect((await run(reader(null), { transactionHash: HASH })).state).toBe("unverified");
    expect((await run(reader("throw"), { transactionHash: HASH })).state).toBe("unverified");
    const base = { blockNumber: 5n, from: "0x1", to: "0x2", contractAddress: null, logs: [] };
    expect((await run(reader({ ...base, status: "reverted" }), { transactionHash: HASH })).state).toBe("unverified");
    expect((await run(reader({ ...base, status: "success" }), { transactionHash: HASH })).state).toBe("verified");
  });

  test("registration is feature detected, passes the signal, and survives a rejecting API", () => {
    const sources = { evidence: () => evidence, reader: () => reader(null) };
    expect(registerEvidenceTools(undefined, new AbortController().signal, sources)).toBe(false);
    expect(registerEvidenceTools({}, new AbortController().signal, sources)).toBe(false);
    const seen: { name: string; signal?: AbortSignal }[] = [];
    const ctx: ModelContextLike = { registerTool: (tool, options) => (seen.push({ name: tool.name, signal: options?.signal }), Promise.reject(new Error("duplicate"))) };
    const controller = new AbortController();
    expect(registerEvidenceTools({ modelContext: ctx }, controller.signal, sources)).toBe(true);
    expect(seen.map((s) => s.name)).toEqual(["get_evidence_summary", "verify_transaction"]);
    expect(seen.every((s) => s.signal === controller.signal)).toBe(true);
    const throwing: ModelContextLike = { registerTool: () => { throw new Error("x"); } };
    expect(registerEvidenceTools({ modelContext: throwing }, controller.signal, sources)).toBe(true);
  });
});
