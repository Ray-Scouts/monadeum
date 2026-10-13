import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DEPLOYMENT } from "@/data/evidence/deployments";
import { middle } from "@/data/evidence/explorer";
import type { Evidence, Verification } from "@/data/evidence/types";
import { keys } from "@/data/evidence/verify";
import { EvidenceReport, type ReportProps } from "./EvidenceReport";

// The page's states rendered to markup. The data below is built for these tests only; the page itself never has any.

const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const ACCOUNT = "0x00000000000000000000000000000000000000ab";
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const noop = () => undefined;
const NOW = Date.parse("2026-10-12T12:00:30.000Z");

const emptyEvidence: Evidence = {
  generatedAt: "2026-10-12T12:00:00.000Z",
  chainId: 10143,
  indexedThrough: null,
  events: { deployed: { count: 0, items: [] }, limitsSet: { count: 0, items: [] }, callAllowed: { count: 0, items: [] }, spent: { count: 0, items: [] } },
  reallocations: { moved: { count: 0, items: [] }, retired: { count: 0, items: [] }, evaluationsAdvanced: { count: 0, items: [] } },
  trades: { count: 0, items: [] },
  payments: { count: 0, items: [] },
};

const base: ReportProps = { evidence: emptyEvidence, apiConfigured: true, error: null, results: new Map(), busy: false, checkedAt: NOW, now: NOW, onRefresh: noop };
const render = (over: Partial<ReportProps> = {}) => renderToStaticMarkup(<EvidenceReport {...base} {...over} />);

describe("empty states", () => {
  test("every category stays visible with an explicit zero and a reason", () => {
    const t = text(render());
    for (const section of ["Deployments", "Agents", "Spend policy proof", "Trades", "x402 payments", "Reallocations and retirements", "Identity (ERC-8004)", "Verify it yourself", "What this page does not show"]) {
      expect(t).toContain(section);
    }
    expect(t).toContain("0 agent accounts deployed");
    expect(t).toContain("0 accepted operations recorded");
    expect(t).toContain("Rejected operations: 0 listed, and that is not a claim that none happened");
    expect(t).toContain("0 trades");
    expect(t).toContain("0 reallocations indexed");
    expect(t).toContain("0 retirements indexed");
    expect(t).toContain("0 x402 payments");
    expect(t).toContain("0 ERC-8004 identities registered");
    expect(t).toContain("0 accepted");
    expect(t).toContain("0 filled");
  });

  test("when the document is not loaded the page says not loaded, never zero", () => {
    const html = render({ evidence: null, error: "The evidence endpoint answered 503." });
    const t = text(html);
    expect(html).toContain('role="alert"');
    expect(t).toContain("The evidence endpoint answered 503.");
    expect(t).toContain("not loaded");
    expect(t).toContain("This is not a count of zero");
    expect(t).not.toContain("0 trades");
    expect(t).not.toContain("0 agent accounts deployed");
  });

  test("without an API configured it says so", () => {
    expect(text(render({ evidence: null, apiConfigured: false }))).toContain("no API configured");
  });
});

describe("verification states", () => {
  test("nothing is green before a check has finished", () => {
    const html = render();
    expect(html).not.toContain(">verified<");
    expect(html).toContain("checking");
  });

  test("a failed check shows unverified with its reason, and only a matching one shows verified", () => {
    const results = new Map<string, Verification>([
      [keys.chain, { state: "verified", detail: "chain 10143" }],
      [keys.read(DEPLOYMENT.contracts.AgentReallocation, "admin"), { state: "unverified", reason: "the chain returns 0xabc, the record says 0xdef" }],
      [keys.read(DEPLOYMENT.contracts.AgentReallocation, "operator"), { state: "verified", detail: DEPLOYMENT.inputs.reallocationOperator }],
    ]);
    const html = render({ results });
    expect(html).toContain(">unverified<");
    expect(html).toContain("the chain returns 0xabc, the record says 0xdef");
    expect(html).toContain(">verified<");
  });

  test("a deployment row is verified only when all of its checks are", () => {
    const d = DEPLOYMENT;
    const ok: Verification = { state: "verified", detail: "ok" };
    const results = new Map<string, Verification>([
      [keys.deployTx("AgentSpendPolicy"), ok],
      [keys.code(d.contracts.AgentSpendPolicy), ok],
      [keys.read(d.contracts.AgentSpendPolicy, "settlementAsset"), { state: "unverified", reason: "the chain returns another asset" }],
    ]);
    const html = render({ results });
    expect(html).toContain("the chain returns another asset");
    expect(text(html)).not.toContain("3 checks match the chain");
  });
});

describe("records", () => {
  const evidence: Evidence = {
    ...emptyEvidence,
    events: {
      deployed: { count: 1, items: [{ account: ACCOUNT, contract: "0x00000000000000000000000000000000000000ee", transactionHash: H(10), blockNumber: "20", logIndex: 1, factory: "0x1", paymaster: "0x2", userOpHash: H(9) }] },
      limitsSet: { count: 1, items: [{ account: ACCOUNT, contract: DEPLOYMENT.contracts.AgentSpendPolicy, transactionHash: H(11), blockNumber: "20", logIndex: 2, perTxCap: "1000000", dailyCap: "5000000" }] },
      callAllowed: { count: 0, items: [] },
      spent: { count: 0, items: [] },
    },
    reallocations: { moved: { count: 1, items: [{ account: ACCOUNT, contract: DEPLOYMENT.contracts.AgentReallocation, transactionHash: H(14), blockNumber: "22", logIndex: 0, sink: "0x00000000000000000000000000000000000000cd", amount: "40000", evaluation: "3" }] }, retired: { count: 0, items: [] }, evaluationsAdvanced: { count: 0, items: [] } },
    trades: { count: 1, items: [{ account: ACCOUNT, transactionHash: H(12), blockNumber: "21", pair: "WMON/USDC", side: "sell", baseAmount: "2000000000000000000", quoteAmount: "1100000", executedPrice: "550000", fee: { asset: "quote", amount: "0", source: "taker-fee-bps" }, costs: { gasWei: "1000000000000000", gas: "100", fees: "0", slippage: "0" }, realizedPnl: "-5000" }] },
    payments: { count: 1, items: [{ provider: "nansen", price: "30000", settlementTransaction: H(13), reconciliation: "anomaly", anomaly: "duplicate-grant" }] },
  };

  test("each record links its hash to the Monad testnet explorer and keeps the full value accessible", () => {
    const html = render({ evidence });
    expect(html).toContain(`href="https://testnet.monadscan.com/tx/${H(12)}"`);
    expect(html).toContain(`href="https://testnet.monadscan.com/address/${ACCOUNT}"`);
    expect(html).toContain(`aria-label="transaction ${H(12)}, opens in the block explorer"`);
    expect(html).toContain(`title="${H(12)}"`);
    expect(html).toContain(middle(H(12)));
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test("counts, amounts, and the realized P&L are shown as recorded", () => {
    const t = text(render({ evidence }));
    expect(t).toContain("1 Kernel accounts deployed");
    expect(t).toContain("1 filled");
    expect(t).toContain("-0.005 USDC");
    expect(t).toContain("1.1 USDC");
    expect(t).toContain("anomaly: duplicate-grant");
    expect(t).toContain("Reallocations (1)");
    expect(t).toContain("0.04 USDC, evaluation 3");
    expect(t).toContain("1 with a settlement tx");
  });

  test("tables and stacked cards come from the same rows, and touch targets are 44 px", () => {
    const html = render({ evidence });
    expect(html).toContain("<table");
    expect(html).toContain("lg:hidden");
    expect(html).toContain("size-11");
    expect(html).toContain("min-h-11");
    expect(html).toContain("<caption");
    expect(html).toContain('scope="col"');
  });
});

describe("freshness and refresh", () => {
  test("shows when the document and the checks were produced, and a refresh button that is disabled while busy", () => {
    const idle = render();
    expect(text(idle)).toContain("2026-10-12 12:00:00 UTC");
    expect(text(idle)).toContain("30 s ago");
    expect(idle).toContain(">Refresh<");
    expect(idle).not.toContain('disabled=""');
    const busy = render({ busy: true, checkedAt: null });
    expect(busy).toContain('disabled=""');
    expect(text(busy)).toContain("Chain checks: running");
  });
});

describe("verify it yourself", () => {
  test("offers cast and viem commands for each class, with the real deployment hash and the documented RPC", () => {
    const html = render();
    const t = text(html);
    expect(t).toContain(`cast receipt ${DEPLOYMENT.transactions.AgentSpendPolicy.hash} --rpc-url https://testnet-rpc.monad.xyz`);
    expect(t).toContain("getTransactionReceipt");
    expect(html).toContain("&lt;TX_HASH&gt;");
    expect(t).toContain("agent(address)((address,uint8,uint256))");
  });
});

describe("what the page does not show", () => {
  test("states the limits in plain words", () => {
    const t = text(render());
    expect(t).toContain("Testnet liquidity is seeded by the team");
    expect(t).toContain("not evidence of trading skill");
    expect(t).toContain("Reallocation. It is off by default");
  });
});

describe("the Envio HyperSync cross-check card", () => {
  const field = {
    source: "envio-hypersync",
    status: "match",
    range: { from: "100", to: "200" },
    counts: { indexer: 3, hypersync: 3 },
    matched: 3,
    missing: { inHyperSync: 0, inIndexer: 0 },
    fieldMismatches: 0,
    hypersyncHeight: "205",
    checkedAt: "2026-10-12T12:00:10.000Z",
  };
  const withField = (crossCheck: unknown) => render({ evidence: { ...emptyEvidence, crossCheck } });

  test("a match shows the title, the range, the counts, the height, the time, and the docs link", () => {
    const html = withField(field);
    const t = text(html);
    expect(t).toContain("Independently cross-checked with Envio HyperSync");
    expect(t).toContain("100 to 200");
    expect(t).toContain("Rows in the indexer 3");
    expect(t).toContain("Rows in HyperSync 3");
    expect(t).toContain("HyperSync height 205");
    expect(t).toContain("2026-10-12 12:00:10 UTC");
    expect(html).toContain('href="https://docs.envio.dev/docs/HyperSync/overview"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">match<");
  });

  test("unverified, mismatch, and a malformed field are never shown as a match", () => {
    const unverified = withField({ ...field, status: "unverified", reason: "unavailable" });
    expect(text(unverified)).toContain("Unverified: HyperSync could not be reached");
    expect(unverified).not.toContain(">match<");
    const mismatch = withField({ ...field, status: "mismatch", fieldMismatches: 2 });
    expect(mismatch).toContain('role="alert"');
    expect(mismatch).not.toContain(">match<");
    const malformed = withField({ status: "match" });
    expect(text(malformed)).toContain("unexpected shape");
    expect(malformed).not.toContain(">match<");
  });

  test("a match older than 15 minutes is unverified", () => {
    const html = render({ evidence: { ...emptyEvidence, crossCheck: field }, now: NOW + 20 * 60_000 });
    expect(text(html)).toContain("older than 15 minutes");
    expect(html).not.toContain(">match<");
  });

  test("without the field the card says it is not running, and without the document it says not loaded", () => {
    expect(text(render())).toContain("is not running the Envio HyperSync cross-check");
    const unloaded = text(render({ evidence: null }));
    expect(unloaded).toContain("Independently cross-checked with Envio HyperSync");
    expect(unloaded).toContain("nothing is claimed about it until the document is read");
  });

  test("the card stacks on narrow screens, wraps long values, and its link is a 44 px target", () => {
    const html = withField(field);
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("min-[400px]:grid-cols-2");
    expect(html).toContain("long-value");
    expect(html).toContain("min-h-11");
  });
});
