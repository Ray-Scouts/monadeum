import { DEPLOYMENT } from "@/data/evidence/deployments";
import { CHAIN_ID, EVIDENCE_EXPLORER, txLink } from "@/data/evidence/explorer";
import type { Evidence } from "@/data/evidence/types";
import { verifyReceipt, type ChainReader } from "@/data/evidence/verify";

// WebMCP (https://webmachinelearning.github.io/webmcp/, a draft): a page can register tools with
// `document.modelContext.registerTool(tool, { signal })`. Read on 2026-10-12: `execute(input, options)` returns a
// promise, `signal` unregisters the tool when aborted, a duplicate name rejects, and `annotations.readOnlyHint` exists.
// The API is a draft and may change, so everything here is behind feature detection and a failure is swallowed: the
// page works the same without it. Both tools only read: no signing, sending, creating, funding, or changing anything.

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: true };
  execute(input: Record<string, unknown>): Promise<unknown>;
}

export interface ModelContextLike {
  registerTool(tool: ToolDefinition, options?: { signal?: AbortSignal }): Promise<unknown> | unknown;
}

export interface ToolSources {
  /** The evidence document the page currently holds, or null when it has none. */
  evidence(): Evidence | null;
  /** The chain reader the page's own checks use. */
  reader(): ChainReader;
}

const HASH = /^0x[0-9a-fA-F]{64}$/;

export function evidenceTools(sources: ToolSources): ToolDefinition[] {
  return [
    {
      name: "get_evidence_summary",
      title: "Evidence summary",
      description:
        "Read-only. Returns what the public evidence endpoint reported to this page: the generation time, the chain, how many records exist in each category (deployments, spend-policy events, reallocation events, trades, x402 payments), and the deployed contract addresses. Counts are reports of an unverified document; use verify_transaction to check a transaction against the chain.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      async execute() {
        const e = sources.evidence();
        const contracts = DEPLOYMENT.contracts;
        if (!e) return { available: false, reason: "The page has no evidence document: the API is not configured or did not answer.", chainId: CHAIN_ID, contracts };
        return {
          available: true,
          generatedAt: e.generatedAt,
          chainId: e.chainId,
          indexedThrough: e.indexedThrough,
          counts: {
            accountDeployments: e.events.deployed.count,
            limitsSet: e.events.limitsSet.count,
            callAllowed: e.events.callAllowed.count,
            spent: e.events.spent.count,
            reallocationsMoved: e.reallocations.moved.count,
            retired: e.reallocations.retired.count,
            evaluationsAdvanced: e.reallocations.evaluationsAdvanced.count,
            trades: e.trades.count,
            payments: e.payments.count,
          },
          contracts,
          explorer: EVIDENCE_EXPLORER,
        };
      },
    },
    {
      name: "verify_transaction",
      title: "Verify a transaction on chain",
      description:
        "Read-only. Re-reads one Monad testnet transaction receipt from the public RPC with the same fail-closed check the page uses. Returns state 'verified' only when the receipt exists and succeeded; any other outcome, including an unreachable RPC, is 'unverified' with a reason. Does not send or sign anything.",
      inputSchema: {
        type: "object",
        properties: { transactionHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$", description: "A 32-byte transaction hash, 0x-prefixed." } },
        required: ["transactionHash"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const hash = input.transactionHash;
        if (typeof hash !== "string" || !HASH.test(hash)) return { state: "unverified", reason: "transactionHash must be a 0x-prefixed 32-byte hex string" };
        const result = await verifyReceipt(sources.reader(), hash);
        return { transactionHash: hash, explorer: txLink(hash), ...result };
      },
    },
  ];
}

/**
 * Registers the tools when the browser has `document.modelContext`, tied to `signal`: aborting it unregisters them.
 * Returns whether registration was attempted. Never throws.
 */
export function registerEvidenceTools(doc: { modelContext?: ModelContextLike } | undefined, signal: AbortSignal, sources: ToolSources): boolean {
  const ctx = doc?.modelContext;
  if (!ctx || typeof ctx.registerTool !== "function") return false;
  for (const tool of evidenceTools(sources)) {
    try {
      Promise.resolve(ctx.registerTool(tool, { signal })).catch(() => undefined);
    } catch {
      // A draft API: a refusal (for example a duplicate name) must not affect the page.
    }
  }
  return true;
}
