import { describe, expect, test } from "bun:test";
import { DEPLOYMENT, RECORDED_CAPITAL_FLOOR } from "./deployments";
import { txLink } from "./explorer";
import type { Evidence, Verification } from "./types";
import { deploymentTasks, evidenceTasks, keys, runChecks, verifyCode, verifyReceipt, type ChainReader, type ChainReceipt, type ReadFn } from "./verify";

// The verifier is exercised against an in-memory chain. What matters is the fail-closed rule: only an exact match is
// verified; everything else, including an RPC that throws, is unverified.

const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const d = DEPLOYMENT;

function receipt(over: Partial<ChainReceipt> = {}): ChainReceipt {
  return { status: "success", blockNumber: 10n, from: "0x00000000000000000000000000000000000000aa", to: "0x00000000000000000000000000000000000000bb", contractAddress: null, logs: [], ...over };
}

class FakeChain implements ChainReader {
  receipts = new Map<string, ChainReceipt>();
  code = new Map<string, number>();
  reads = new Map<string, unknown>();
  id = 10143;
  down = false;
  calls = 0;
  async chainId() {
    if (this.down) throw new Error("fetch failed");
    return this.id;
  }
  async receipt(hash: string) {
    this.calls++;
    if (this.down) throw new Error("fetch failed");
    return this.receipts.get(hash.toLowerCase()) ?? null;
  }
  async codeSize(address: string) {
    if (this.down) throw new Error("fetch failed");
    return this.code.get(address.toLowerCase()) ?? 0;
  }
  async read(address: string, fn: ReadFn) {
    if (this.down) throw new Error("fetch failed");
    if (!this.reads.has(`${address.toLowerCase()}:${fn}`)) throw new Error("execution reverted");
    return this.reads.get(`${address.toLowerCase()}:${fn}`);
  }
}

/** A chain that matches the deployment record exactly. */
function matchingChain(): FakeChain {
  const c = new FakeChain();
  for (const [name, tx] of Object.entries(d.transactions)) {
    const address = d.contracts[name as keyof typeof d.contracts];
    c.receipts.set(tx.hash.toLowerCase(), receipt({ blockNumber: BigInt(tx.block), from: d.deployer, to: null, contractAddress: address }));
    c.code.set(address.toLowerCase(), 5000);
    c.reads.set(`${address.toLowerCase()}:settlementAsset`, d.inputs.settlementAsset);
  }
  const r = d.contracts.AgentReallocation.toLowerCase();
  c.reads.set(`${r}:operator`, d.inputs.reallocationOperator);
  c.reads.set(`${r}:admin`, d.inputs.reallocationAdmin);
  c.reads.set(`${r}:minEvaluationInterval`, BigInt(d.inputs.minEvaluationInterval));
  c.reads.set(`${r}:capitalFloor`, RECORDED_CAPITAL_FLOOR);
  c.reads.set(`${r}:currentEvaluation`, 0n);
  c.reads.set(`${r}:lastEvaluationAt`, 0n);
  c.code.set(d.safe.address.toLowerCase(), 1000);
  c.reads.set(`${d.safe.address.toLowerCase()}:getThreshold`, BigInt(d.safe.threshold));
  c.reads.set(`${d.safe.address.toLowerCase()}:getOwners`, [...d.safe.owners]);
  return c;
}

async function run(reader: ChainReader, tasks = deploymentTasks(reader, d)) {
  const out = new Map<string, Verification>();
  await runChecks(reader, tasks, (k, v) => out.set(k, v));
  return out;
}

describe("deployment record", () => {
  test("a chain that matches the record verifies every check", async () => {
    const out = await run(matchingChain());
    expect(out.get(keys.chain)?.state).toBe("verified");
    expect(out.size).toBeGreaterThan(15);
    for (const [key, v] of out) expect(`${key}:${v.state}`).toBe(`${key}:verified`);
  });

  test("a wrong on-chain value is unverified, with the values in the reason", async () => {
    const c = matchingChain();
    c.reads.set(`${d.contracts.AgentReallocation.toLowerCase()}:minEvaluationInterval`, 1n);
    const out = await run(c);
    const v = out.get(keys.read(d.contracts.AgentReallocation, "minEvaluationInterval"));
    expect(v?.state).toBe("unverified");
    expect(v?.state === "unverified" && v.reason).toContain("the chain returns 1");
  });

  test("a different operator, a missing receipt, a wrong block, a wrong sender, and no code each fail", async () => {
    const c = matchingChain();
    c.reads.set(`${d.contracts.AgentReallocation.toLowerCase()}:operator`, "0x00000000000000000000000000000000000000ff");
    c.receipts.delete(d.transactions.AgentSpendPolicy.hash.toLowerCase());
    const reallocTx = d.transactions.AgentReallocation;
    c.receipts.set(reallocTx.hash.toLowerCase(), receipt({ blockNumber: BigInt(reallocTx.block + 1), from: d.deployer, to: null, contractAddress: d.contracts.AgentReallocation }));
    const x402Tx = d.transactions.X402PaymentValidator;
    c.receipts.set(x402Tx.hash.toLowerCase(), receipt({ blockNumber: BigInt(x402Tx.block), from: "0x00000000000000000000000000000000000000aa", to: null, contractAddress: d.contracts.X402PaymentValidator }));
    c.code.set(d.contracts.AgentSpendPolicy.toLowerCase(), 0);
    const out = await run(c);
    for (const key of [keys.read(d.contracts.AgentReallocation, "operator"), keys.deployTx("AgentSpendPolicy"), keys.deployTx("AgentReallocation"), keys.deployTx("X402PaymentValidator"), keys.code(d.contracts.AgentSpendPolicy)]) {
      expect(out.get(key)?.state).toBe("unverified");
    }
    expect(out.get(keys.code(d.contracts.AgentReallocation))?.state).toBe("verified");
  });

  test("a reverted deployment receipt is unverified", async () => {
    const c = matchingChain();
    const tx = d.transactions.AgentSpendPolicy;
    c.receipts.set(tx.hash.toLowerCase(), receipt({ status: "reverted", blockNumber: BigInt(tx.block), from: d.deployer, to: null, contractAddress: d.contracts.AgentSpendPolicy }));
    expect((await run(c)).get(keys.deployTx("AgentSpendPolicy"))?.state).toBe("unverified");
  });

  test("an unreachable RPC leaves nothing verified and sends no further request", async () => {
    const c = matchingChain();
    c.down = true;
    const out = await run(c);
    expect(out.get(keys.chain)?.state).toBe("unverified");
    for (const v of out.values()) expect(v.state).toBe("unverified");
    expect(c.calls).toBe(0);
  });

  test("a node on another chain verifies nothing", async () => {
    const c = matchingChain();
    c.id = 1;
    const out = await run(c);
    for (const v of out.values()) expect(v.state).toBe("unverified");
  });

  test("an RPC that fails after the chain check is unverified per check, never verified", async () => {
    const c = matchingChain();
    c.read = async () => {
      throw new Error("boom");
    };
    const out = await run(c);
    expect(out.get(keys.read(d.contracts.AgentReallocation, "admin"))?.state).toBe("unverified");
    expect(out.get(keys.code(d.contracts.AgentReallocation))?.state).toBe("verified");
  });
});

describe("single checks", () => {
  test("a malformed hash is refused without asking the chain", async () => {
    const c = new FakeChain();
    expect((await verifyReceipt(c, "0x1234")).state).toBe("unverified");
    expect(c.calls).toBe(0);
  });

  test("a malformed address has no code check", async () => {
    expect((await verifyCode(new FakeChain(), "not-an-address")).state).toBe("unverified");
  });

  test("a log expectation needs the emitter and the log index to match", async () => {
    const c = new FakeChain();
    const emitter = "0x00000000000000000000000000000000000000cc";
    c.receipts.set(H(1), receipt({ logs: [{ address: emitter, logIndex: 3 }] }));
    expect((await verifyReceipt(c, H(1), { log: { address: emitter, logIndex: 3 } })).state).toBe("verified");
    expect((await verifyReceipt(c, H(1), { log: { address: emitter, logIndex: 4 } })).state).toBe("unverified");
    expect((await verifyReceipt(c, H(1), { log: { address: "0x00000000000000000000000000000000000000dd", logIndex: 3 } })).state).toBe("unverified");
  });
});

describe("evidence records", () => {
  const policy = d.contracts.AgentSpendPolicy;
  const account = "0x00000000000000000000000000000000000000ab";
  const ev = { account, contract: policy, transactionHash: H(11), blockNumber: "20", logIndex: 2 };
  const evidence: Evidence = {
    generatedAt: "2026-10-12T00:00:00.000Z",
    chainId: 10143,
    indexedThrough: "30",
    events: {
      deployed: { count: 1, items: [{ ...ev, contract: "0x00000000000000000000000000000000000000ee", transactionHash: H(10), logIndex: 1, factory: "0x1", paymaster: "0x2", userOpHash: H(9) }] },
      limitsSet: { count: 1, items: [{ ...ev, perTxCap: "1", dailyCap: "2" }] },
      callAllowed: { count: 0, items: [] },
      spent: { count: 0, items: [] },
    },
    reallocations: { moved: { count: 1, items: [{ ...ev, contract: d.contracts.AgentReallocation, transactionHash: H(14), logIndex: 0, sink: account, amount: "1", evaluation: "1" }] }, retired: { count: 0, items: [] }, evaluationsAdvanced: { count: 0, items: [] } },
    trades: { count: 1, items: [{ account, transactionHash: H(12), blockNumber: "21", pair: "WMON/USDC", side: "buy", baseAmount: "1", quoteAmount: "1", executedPrice: "1", fee: { asset: "base", amount: "0", source: "trade-events" }, costs: null, realizedPnl: null }] },
    payments: { count: 1, items: [{ provider: "nansen", price: "30000", settlementTransaction: H(13), reconciliation: "settled", anomaly: null }] },
  };

  function chain(): FakeChain {
    const c = new FakeChain();
    c.receipts.set(H(10), receipt({ blockNumber: 20n, logs: [{ address: "0x00000000000000000000000000000000000000ee", logIndex: 1 }] }));
    c.receipts.set(H(11), receipt({ blockNumber: 20n, logs: [{ address: policy, logIndex: 2 }] }));
    c.receipts.set(H(12), receipt({ blockNumber: 21n }));
    c.receipts.set(H(13), receipt({ blockNumber: 22n }));
    c.receipts.set(H(14), receipt({ blockNumber: 20n, logs: [{ address: d.contracts.AgentReallocation, logIndex: 0 }] }));
    c.code.set(account, 100);
    c.reads.set(`${d.contracts.AgentReallocation.toLowerCase()}:agent`, { owner: "0x0", status: 1, principal: 0n });
    return c;
  }

  test("records that match their receipts are verified", async () => {
    const c = chain();
    const out = await run(c, evidenceTasks(c, d, evidence));
    expect(out.get(keys.event(H(10), 1))?.state).toBe("verified");
    expect(out.get(keys.event(H(11), 2))?.state).toBe("verified");
    expect(out.get(keys.event(H(14), 0))?.state).toBe("verified");
    expect(out.get(keys.trade(H(12)))?.state).toBe("verified");
    expect(out.get(keys.payment(H(13)))?.state).toBe("verified");
    expect(out.get(keys.code(account))?.state).toBe("verified");
    expect(out.get(keys.agentStatus(account))).toEqual({ state: "verified", detail: "Active" });
  });

  test("a trade claimed in the wrong block, an unknown payment, and an event from another contract are unverified", async () => {
    const c = chain();
    c.receipts.set(H(12), receipt({ blockNumber: 99n }));
    c.receipts.delete(H(13));
    c.receipts.set(H(11), receipt({ blockNumber: 20n, logs: [{ address: "0x00000000000000000000000000000000000000dd", logIndex: 2 }] }));
    const out = await run(c, evidenceTasks(c, d, evidence));
    expect(out.get(keys.trade(H(12)))?.state).toBe("unverified");
    expect(out.get(keys.payment(H(13)))?.state).toBe("unverified");
    expect(out.get(keys.event(H(11), 2))?.state).toBe("unverified");
  });

  test("a spend event the record attributes to a contract other than the deployed AgentSpendPolicy is unverified without a request", async () => {
    const c = chain();
    const forged: Evidence = { ...evidence, events: { ...evidence.events, limitsSet: { count: 1, items: [{ ...evidence.events.limitsSet.items[0]!, contract: "0x00000000000000000000000000000000000000dd" }] } } };
    const before = c.calls;
    const out = await run(c, evidenceTasks(c, d, forged));
    expect(out.get(keys.event(H(11), 2))?.state).toBe("unverified");
    expect(c.calls).toBe(before + 3);
  });

  test("the explorer link is the Monadscan testnet transaction page", () => {
    expect(txLink(H(1))).toBe(`https://testnet.monadscan.com/tx/${H(1)}`);
  });
});
