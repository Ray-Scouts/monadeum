import { FitnessService } from "@monadeum/fitness";
import { ReallocationService, type ReallocationSwitch } from "@monadeum/reallocation";
import { RiskService } from "@monadeum/risk";
import { StrategyService } from "@monadeum/strategy";
import type { TickResult } from "@monadeum/tick";
import { WalletsTradeSigner, buildKuruTrading, type TradingConfig, type TradingService } from "@monadeum/trading";
import { loadWalletsConfig, type WalletsService } from "@monadeum/wallets";
import { X402Client, type Provider, type ProviderEndpoint } from "@monadeum/x402";
import { ethers } from "ethers";
import { createPublicClient, http, zeroAddress, type Address, type Hex } from "viem";
import { PopulationBreaker, type BreakerThresholds } from "./breaker.js";
import { RpcChainReader, rpcReads } from "./chain.js";
import { WorkerConfigError, type TickRunnerConfig } from "./config.js";
import type { TickRunner } from "./consumer/handlers.js";
import { KuruMidSignal, rpcBookReader } from "./market.js";
import { coverageProblems, policyTarget, type PolicyTarget, type PolicyVersions } from "./policy.js";
import type { ChainReader, MarketSource } from "./ports.js";
import type { WorkerStores } from "./stores.js";
import { AgentWorker } from "./worker.js";
import { DisabledX402Payer } from "./x402.js";

/**
 * Runs each tick only under a verified risk policy (ARCHITECTURE.md sections 11 and 16.1). Before every tick it samples
 * the market (so the signal's series builds whether or not the tick runs), then reads the stored policy versions and
 * verifies them with `loadPolicy` against the pinned signer, at the current time. Without a verified version in
 * effect that covers the configured market and settlement asset, the tick is skipped before anything is claimed,
 * decided, or sent, and the log says why; the next tick checks again, so appending a version takes effect without a
 * restart. Evaluations run regardless: they compute fitness and apply retirement and, with reallocation off, move
 * nothing (a reallocation, if ever on, is still gated by the same RiskService, which rejects everything without a policy).
 */
export class PolicyGatedRunner implements TickRunner {
  constructor(
    private readonly deps: {
      worker: Pick<AgentWorker, "tick" | "evaluate">;
      risk: Pick<RiskService, "load" | "active">;
      policies: PolicyVersions;
      signer: Address;
      target: PolicyTarget;
      market?: { sample(): Promise<unknown> };
      clock: () => Date;
      log: (message: string) => void;
    },
  ) {}

  /** Loads and verifies the policy now. Null when a verified version covering the market is in effect, else why not. */
  async checkPolicy(): Promise<string | null> {
    const { risk, policies, signer, target, clock } = this.deps;
    let rows;
    try {
      rows = await policies.list();
    } catch (error) {
      return `the risk policy versions could not be read (${error instanceof Error ? error.message : String(error)})`;
    }
    if (rows.length === 0) return "no signed risk policy version is stored";
    if (!(await risk.load(rows, signer, clock()))) return `no risk policy version signed by ${signer} verifies and is in effect`;
    const problems = coverageProblems(risk.active()!.document, target);
    if (problems.length > 0) return `risk policy version ${risk.active()!.document.version} does not cover the configured market: ${problems.join("; ")}`;
    return null;
  }

  async tick(agentId: string, tick: number): Promise<TickResult | null> {
    const { market, worker, log } = this.deps;
    await market?.sample().catch(() => null);
    const problem = await this.checkPolicy();
    if (problem) {
      log(`tick ${agentId}:${tick} skipped, nothing decided or sent: ${problem}`);
      return null;
    }
    const result = await worker.tick(agentId, tick);
    log(`tick ${agentId}:${tick}: ${describe(result)}`);
    return result;
  }

  evaluate(tick: number) {
    return this.deps.worker.evaluate(tick);
  }
}

function describe(result: TickResult | null): string {
  if (!result) return "not ticked (unfunded, retired, or the population breaker is tripped)";
  const o = result.outcome;
  if (!o) return `${result.action}, retry ${result.retry}`;
  if (o.kind === "failed") return `${result.action}, failed at ${o.step}: ${o.reason}${o.violations ? ` [${o.violations.join(", ")}]` : ""}`;
  return `${result.action} (${o.kind})`;
}

/**
 * Never contacted: the runner's settings offer no information, so no tick builds a purchase (`AgentWorker` makes an
 * offer only when `settings.information` is set). `.invalid` is reserved (RFC 2606) and never resolves.
 */
const NO_PROVIDERS: Record<Provider, ProviderEndpoint> = {
  nansen: { baseUrl: "https://nansen.x402.invalid", payTo: zeroAddress },
  defillama: { baseUrl: "https://defillama.x402.invalid", payTo: zeroAddress },
};

/**
 * Assembles the runner from its edges: the production modules (StrategyService, RiskService, X402Client with no payer,
 * the given TradingService, FitnessService, ReallocationService with no owner policy and no executor) and the given chain
 * reader and market source. `buildTickRunner` passes the RPC-backed edges; tests pass fakes.
 */
export function assembleTickRunner(parts: {
  stores: Pick<WorkerStores, "agents" | "ticks" | "evaluations" | "payments" | "policies" | "breaker">;
  /** The population breaker's thresholds (SECURITY.md section 9, layer 3). */
  breaker: BreakerThresholds;
  chain: ChainReader;
  market: MarketSource & { sample(): Promise<unknown> };
  trading: TradingService;
  /** The settlement asset and the CAIP-2 network an X402Client is built for, though it never buys. */
  settlementAsset: Hex;
  network: string;
  reallocation: ReallocationSwitch;
  maxSlippageBps: number;
  signer: Address;
  target: PolicyTarget;
  clock: () => Date;
  log: (message: string) => void;
}): { runner: PolicyGatedRunner; worker: AgentWorker; risk: RiskService } {
  const risk = new RiskService();
  const x402 = new X402Client(NO_PROVIDERS, parts.settlementAsset, parts.network, new DisabledX402Payer(), parts.stores.payments);
  const worker = new AgentWorker({
    agents: parts.stores.agents,
    ticks: parts.stores.ticks,
    evaluations: parts.stores.evaluations,
    chain: parts.chain,
    market: parts.market,
    strategy: new StrategyService(),
    risk,
    x402,
    trading: parts.trading,
    fitness: new FitnessService(),
    // No owner policy and no executor: even with the switch on, nothing is planned or settled (section 5).
    reallocation: new ReallocationService(),
    settings: { maxSlippageBps: parts.maxSlippageBps, information: null, reallocation: parts.reallocation, clock: parts.clock },
    breaker: new PopulationBreaker(parts.stores.breaker, parts.breaker, parts.clock),
  });
  const runner = new PolicyGatedRunner({
    worker, risk, policies: parts.stores.policies, signer: parts.signer, target: parts.target, market: parts.market, clock: parts.clock, log: parts.log,
  });
  return { runner, worker, risk };
}

/**
 * Builds the production tick runner (`WORKER_TICK_RUNNER=enabled`) from the booted worker: viem reads over
 * `WORKER_RPC_URL` for balances, the spend policy's window, and the Kuru book; TradingService from `buildKuruTrading`
 * (which verifies the market against the chain) over `WalletsTradeSigner` on the worker's WalletsModule; and the policy
 * gate. Before returning it checks, and refuses to start on a mismatch, that the RPC serves WalletsModule's chain, that
 * the spend policy counts the configured settlement asset, and that the token reports the configured decimals. Without a
 * verified policy it starts and skips every tick, saying so, except in production, where it refuses to start.
 */
export async function buildTickRunner(input: {
  config: Extract<TickRunnerConfig, { enabled: true }>;
  env: Record<string, string | undefined>;
  stores: WorkerStores;
  reallocation: ReallocationSwitch;
  wallets: WalletsService | null;
  trading: TradingConfig | null;
  tickIntervalMs: number;
  production: boolean;
  clock: () => Date;
  log: (message: string) => void;
}): Promise<TickRunner> {
  const { config, wallets, trading, log } = input;
  if (!wallets) throw new WorkerConfigError("WORKER_TICK_RUNNER is enabled but WalletsModule is not configured");
  if (!trading) throw new WorkerConfigError("WORKER_TICK_RUNNER is enabled but no trading market is configured");
  const walletsConfig = loadWalletsConfig(input.env);
  let target: PolicyTarget;
  try {
    target = policyTarget(walletsConfig, trading).target;
  } catch (error) {
    throw new WorkerConfigError(error instanceof Error ? error.message : String(error));
  }

  const chainId = walletsConfig.chain.chain.id;
  const rpc = rpcReads(createPublicClient({ chain: walletsConfig.chain.chain, transport: http(config.rpcUrl) }));
  const served = await rpc.getChainId();
  if (served !== chainId) throw new WorkerConfigError(`WORKER_RPC_URL serves chain ${served}, not ${chainId}`);
  const chain = new RpcChainReader(rpc, { settlementAsset: target.settlementAsset, spendPolicy: walletsConfig.chain.spendPolicy.address, tradedAsset: target.tradedBase });
  const counted = await chain.policySettlementAsset();
  if (counted.toLowerCase() !== target.settlementAsset.toLowerCase()) {
    throw new WorkerConfigError(`the spend policy counts ${counted}, not the configured settlement asset ${target.settlementAsset}`);
  }
  const decimals = await chain.decimals();
  if (decimals !== trading.market.quoteDecimals) throw new WorkerConfigError(`the settlement asset has ${decimals} decimals, not TRADING_QUOTE_DECIMALS ${trading.market.quoteDecimals}`);

  const provider = new ethers.providers.StaticJsonRpcProvider(config.rpcUrl, { chainId, name: walletsConfig.chain.chain.name });
  const { trading: service } = await buildKuruTrading(trading, provider, {
    signer: new WalletsTradeSigner(wallets),
    trades: input.stores.trades,
    positions: input.stores.positions,
  });
  const market = new KuruMidSignal({
    market: trading.market.market,
    symbol: trading.market.pair.split("/")[0]!,
    reader: rpcBookReader(rpc, trading.market.market),
    samples: input.stores.marketSamples,
    tickIntervalMs: input.tickIntervalMs,
    limits: config.marketData,
    clock: input.clock,
  });
  const { runner } = assembleTickRunner({
    stores: input.stores,
    chain,
    market,
    trading: service,
    settlementAsset: target.settlementAsset,
    network: `eip155:${chainId}`,
    reallocation: input.reallocation,
    maxSlippageBps: config.maxSlippageBps,
    breaker: config.breaker,
    signer: config.policySigner,
    target,
    clock: input.clock,
    log,
  });
  const problem = await runner.checkPolicy();
  if (problem && input.production) throw new WorkerConfigError(`MONADEUM_ENV is production and ${problem}`);
  log(problem ? `tick runner: ${problem}; every tick is skipped until a valid version is appended` : "tick runner: risk policy verified and in effect");
  log(`population breaker: capital at risk above ${config.breaker.capitalAtRisk} base units halts every tick until a human clears it`);
  log(`tick runner enabled: ${trading.market.pair} on ${trading.market.market}, signal from that book's mid, slippage bound ${config.maxSlippageBps} bps, x402 off, information not bought`);
  return runner;
}
