import assert from "node:assert/strict";
import { test } from "node:test";
import { hashRiskPolicy, type GenomeV1 } from "@monadeum/commitment";
import { REALLOCATION_DISABLED } from "@monadeum/reallocation";
import type { PolicyDocument } from "@monadeum/risk";
import { MemoryMidSampleStore, type SellOrder } from "@monadeum/trading";
import { APPROVE_SELECTOR } from "@monadeum/wallets";
import { decodeFunctionData, erc20Abi } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { KuruMidSignal, type BookReading } from "../src/market.js";
import { MemoryPolicyVersions, type PolicyTarget } from "../src/policy.js";
import { assembleTickRunner } from "../src/runner.js";
import { UNIT, WETH_MARKET, policyDocument, world } from "./harness.js";

// The production tick runner (ARCHITECTURE.md section 11, "Tick runner") assembled by `assembleTickRunner`, the code
// `buildTickRunner` runs, over the harness fakes at the edges: WalletsModule on FakeChain, Kuru, the settlement token
// as the chain reader, and a Kuru book reader that reads the fake book. The policy gate and the market signal are the
// production ones.

const HOUR = 3_600_000;
const START = 498_000; // 2026-10-23, after the harness policy's effectiveFrom
const operator = privateKeyToAccount(generatePrivateKey());

const genome = (overrides: Partial<GenomeV1> = {}): GenomeV1 => ({
  schemaVersion: 1, strategyType: "trading", assetUniverse: [WETH_MARKET.pair], riskTolerance: 0.1, executionFrequency: 1,
  timeHorizon: 2, entryThreshold: 0.0002, exitThreshold: 0, informationSources: [], informationBudget: 0n, modelConfiguration: "low",
  ...overrides,
});

const target: PolicyTarget = { settlementAsset: WETH_MARKET.quote, pair: WETH_MARKET.pair, router: WETH_MARKET.router, tradedBase: WETH_MARKET.base };

/** The deployment's policy: the harness allowlist plus approve on the traded base, at 50 USDC per action. */
function deploymentPolicy(overrides: Partial<PolicyDocument> = {}): PolicyDocument {
  const base = policyDocument({}, WETH_MARKET);
  return policyDocument({ allowedCalls: [...base.allowedCalls, { target: WETH_MARKET.base, selector: APPROVE_SELECTOR, label: "traded-asset" }], ...overrides }, WETH_MARKET);
}

async function signed(document: PolicyDocument, by: PrivateKeyAccount = operator) {
  return { document, signer: by.address, signature: await by.signMessage({ message: { raw: hashRiskPolicy(document) } }) };
}

async function setup(options: { policy?: "valid" | "none" | "other-signer" | "other-pair" } = {}) {
  const w = await world({ market: "weth", information: false, agents: [{ agentId: "1", owner: "a" }] });
  const record = (await w.stores.agents.get("1"))!;
  await w.stores.agents.update({ ...record, genomeDocument: genome() });

  const policies = new MemoryPolicyVersions();
  const mode = options.policy ?? "valid";
  if (mode === "valid") await policies.append(await signed(deploymentPolicy()));
  if (mode === "other-signer") await policies.append(await signed(deploymentPolicy(), privateKeyToAccount(generatePrivateKey())));
  if (mode === "other-pair") await policies.append(await signed(deploymentPolicy({ allowedPairs: ["MON/USDC"] })));

  let now = new Date(START * HOUR + 60_000);
  let staleness = 1;
  let bookDown = false;
  const samples = new MemoryMidSampleStore();
  const reader = {
    read: async (): Promise<BookReading> => {
      if (bookDown) throw new Error("rpc down");
      return { bid: w.kuru.bid, ask: w.kuru.ask, blockNumber: 1n, blockTimestamp: BigInt(Math.floor(now.getTime() / 1000) - staleness) };
    },
  };
  const logs: string[] = [];
  const clock = () => now;

  async function runner() {
    const { trading } = await w.boot();
    const market = new KuruMidSignal({ market: WETH_MARKET.market, symbol: "WETH", reader, samples, tickIntervalMs: HOUR, limits: { maxAgeSeconds: 60, maxSpreadBps: 200 }, clock });
    return assembleTickRunner({
      stores: { ...w.stores, policies }, chain: w.token, market, trading, settlementAsset: WETH_MARKET.quote, network: "eip155:10143",
      reallocation: REALLOCATION_DISABLED, maxSlippageBps: 100, signer: operator.address, target, clock, log: (m) => logs.push(m),
      breaker: { capitalAtRisk: 10n ** 30n, reallocationVolume: null },
    });
  }

  return {
    w, policies, samples, logs, runner,
    /** Moves the clock to tick START + k and the book to a mid of `mid` USDC per WETH, 20 USDC wide. */
    at(k: number, mid: bigint) {
      now = new Date((START + k) * HOUR + 60_000);
      w.kuru.bid = (mid - 10n) * 10n ** 18n;
      w.kuru.ask = (mid + 10n) * 10n ** 18n;
      return START + k;
    },
    stale(seconds: number) { staleness = seconds; },
    down(value: boolean) { bookDown = value; },
  };
}

test("without a stored policy no tick runs: nothing is claimed, decided, or sent, and the market is still sampled", async () => {
  const s = await setup({ policy: "none" });
  const { runner } = await s.runner();
  const tick = s.at(0, 2_500n);
  assert.equal(await runner.tick("1", tick), null);
  assert.equal(await s.w.stores.ticks.get(`1:${tick}`), undefined, "no tick record was claimed");
  assert.equal(s.w.sessionOps().length, 0);
  assert.match(s.logs.join("\n"), /skipped, nothing decided or sent: no signed risk policy version is stored/);
  assert.equal((await s.samples.range(WETH_MARKET.market, tick, tick)).length, 1, "the signal's series still builds");
});

test("a policy signed by another key, or one that does not cover the market, is no policy: no tick runs", async () => {
  for (const policy of ["other-signer", "other-pair"] as const) {
    const s = await setup({ policy });
    const { runner, risk } = await s.runner();
    const tick = s.at(0, 2_500n);
    assert.equal(await runner.tick("1", tick), null, policy);
    assert.equal(await s.w.stores.ticks.get(`1:${tick}`), undefined, policy);
    assert.equal(s.w.sessionOps().length, 0, policy);
    assert.match(s.logs.join("\n"), policy === "other-signer" ? /no risk policy version signed by .* verifies/ : /does not cover the configured market: it does not allow the pair WETH\/USDC/);
    if (policy === "other-signer") assert.equal(risk.active(), null);
  }
});

test("a full tick buys within the caps once the signal's window is whole, and a later flat decision closes the position", async () => {
  const s = await setup();
  const { runner, risk } = await s.runner();
  const account = s.w.accounts.get("1")!;

  // Ticks 0 and 1: fewer than timeHorizon + 1 samples, so no signal and no action.
  for (const [k, mid] of [[0, 2_500n], [1, 2_510n]] as const) {
    const result = await runner.tick("1", s.at(k, mid));
    assert.equal(result?.action, "none");
    assert.deepEqual(result?.outcome?.kind === "failed" && result.outcome.step, "observe");
  }
  assert.equal(s.w.sessionOps().length, 0);

  // Tick 2: the mid rose 0.4% a tick, above the 0.0002 entry threshold: buy capital * riskTolerance, 10 USDC.
  const buyTick = s.at(2, 2_520n);
  const bought = await runner.tick("1", buyTick);
  assert.equal(bought?.action, "executed");
  const buy = (await s.w.stores.trades.get(`1:${buyTick}`))!;
  const approve = decodeFunctionData({ abi: erc20Abi, data: buy.calls[0]!.data });
  assert.equal(approve.functionName, "approve");
  assert.equal(approve.args[1], 10n * UNIT);
  assert.ok((approve.args[1] as bigint) <= deploymentPolicy().perActionCap, "within the per-action cap");
  assert.equal(await s.w.token.windowTotal(account), 10n * UNIT, "the window the RiskModule reads is the one the chain counted");
  assert.equal(risk.active()?.document.version, 1, "decided under the verified version");
  const position = await s.w.stores.positions.get("1");
  assert.ok(position && position.size > 0n);

  // Tick 3: inside the execution interval, no decision. Tick 4: the mid fell, the signal is negative: close it all.
  assert.equal((await runner.tick("1", s.at(3, 2_400n)))?.outcome?.kind, "no-action");
  const closeTick = s.at(4, 2_300n);
  assert.equal((await runner.tick("1", closeTick))?.action, "executed");
  const close = (await s.w.stores.trades.get(`1:${closeTick}`))!;
  assert.equal((close.order as SellOrder).baseIn, position!.size, "sold exactly the open size");
  assert.equal(s.w.kuru.baseOf(account), 0n);
  assert.equal((await s.w.stores.positions.get("1"))!.size, 0n);
  assert.equal(s.w.sessionOps().length, 2);
  assert.match(s.logs.join("\n"), new RegExp(`tick 1:${closeTick}: executed`));
});

test("stale or missing market data means no action: the tick fails closed at observe and nothing is sent", async () => {
  const s = await setup();
  const { runner } = await s.runner();
  for (const [k, mid] of [[0, 2_500n], [1, 2_510n]] as const) await runner.tick("1", s.at(k, mid));

  // The block read is two minutes behind the clock: older than the 60 second bound.
  s.stale(120);
  const stale = await runner.tick("1", s.at(2, 2_520n));
  assert.equal(stale?.outcome?.kind === "failed" && stale.outcome.step, "observe");
  assert.equal(s.w.sessionOps().length, 0);
  assert.equal((await s.samples.range(WETH_MARKET.market, START + 2, START + 2)).length, 0, "a stale reading is never recorded");

  // The book cannot be read at all.
  s.stale(1);
  s.down(true);
  const missing = await runner.tick("1", s.at(3, 2_530n));
  assert.equal(missing?.outcome?.kind === "failed" && missing.outcome.step, "observe");
  assert.equal(s.w.sessionOps().length, 0);

  // Back up, but tick 3 has no sample and tick 2 none either: the window has a gap, so still no signal.
  s.down(false);
  const gap = await runner.tick("1", s.at(4, 2_540n));
  assert.equal(gap?.outcome?.kind === "failed" && gap.outcome.step, "observe");

  // A one-sided book, and a spread wider than 200 bps, are no reading either.
  const oneSided = s.at(5, 2_550n);
  s.w.kuru.bid = 0n;
  assert.equal((await runner.tick("1", oneSided))?.outcome?.kind, "failed");
  const wide = s.at(6, 2_560n);
  s.w.kuru.bid = 2_000n * 10n ** 18n;
  assert.equal((await runner.tick("1", wide))?.outcome?.kind, "failed");
  assert.equal((await s.samples.range(WETH_MARKET.market, oneSided, wide)).length, 0);
  assert.equal(s.w.sessionOps().length, 0);
});

test("restart reconciliation holds under the runner: an approved buy whose response was lost is reconciled, not resent", async () => {
  const s = await setup();
  const first = await s.runner();
  for (const [k, mid] of [[0, 2_500n], [1, 2_510n]] as const) await first.runner.tick("1", s.at(k, mid));
  const tick = s.at(2, 2_520n);
  // The bundler accepts the approved buy, then the response is lost: the outcome is unknown.
  s.w.chain.options.submit = "accepted-then-throw";
  assert.equal((await first.runner.tick("1", tick))?.action, "pending");
  s.w.chain.options.submit = "ok";

  // A restarted worker: every service built again over the same stores. The same key reconciles and decides nothing.
  s.w.chain.mine();
  const second = await s.runner();
  assert.equal((await second.runner.tick("1", tick))?.action, "executed");
  assert.equal(s.w.sessionOps().length, 1, "one operation, included once");
  assert.equal((await s.w.stores.trades.get(`1:${tick}`))?.status, "filled");
  assert.equal((await s.w.stores.ticks.get(`1:${tick}`))?.status, "recorded");
});

test("the runner's evaluation runs under the gate's worker and plans nothing with reallocation off", async () => {
  const s = await setup({ policy: "none" });
  const { runner } = await s.runner();
  const result = (await runner.evaluate(20)) as { reallocationEnabled: boolean; settled: unknown[] };
  assert.equal(result.reallocationEnabled, false);
  assert.deepEqual(result.settled, []);
});

test("the signal is the trailing mean of the mid's per-tick returns over timeHorizon, minus the entry threshold", async () => {
  const samples = new MemoryMidSampleStore();
  let now = new Date(START * HOUR + 1_000);
  let mid = 1_000n * 10n ** 18n;
  const signal = new KuruMidSignal({
    market: WETH_MARKET.market, symbol: "WETH", samples, tickIntervalMs: HOUR, limits: { maxAgeSeconds: 60, maxSpreadBps: 200 }, clock: () => now,
    reader: { read: async () => ({ bid: mid - 10n ** 17n, ask: mid + 10n ** 17n, blockNumber: 7n, blockTimestamp: BigInt(Math.floor(now.getTime() / 1000)) }) },
  });
  const agent = { genomeDocument: genome({ timeHorizon: 3, entryThreshold: 0.001 }) } as Parameters<typeof signal.read>[0];
  const mids = [1_000n, 1_010n, 1_000n, 1_030n];
  for (const [i, m] of mids.entries()) {
    now = new Date((START + i) * HOUR + 1_000);
    mid = m * 10n ** 18n;
    await signal.sample();
  }
  // A second reading inside the last tick keeps the tick's first mid.
  mid = 5_000n * 10n ** 18n;
  const reading = await signal.read(agent);
  const expected = (0.01 + (1_000 / 1_010 - 1) + 0.03) / 3 - 0.001;
  assert.ok(reading && Math.abs(reading.signal - expected) < 1e-12, `${reading?.signal} vs ${expected}`);
  assert.equal(reading?.symbol, "WETH");
  assert.equal(await signal.read({ genomeDocument: undefined } as never), null, "no genome document, no signal");
});
