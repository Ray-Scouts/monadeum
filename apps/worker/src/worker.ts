import { median, nicheKey, sortinoParts, type CostedFill, type FitnessService } from "@monadeum/fitness";
import {
  EVALUATION_CADENCE,
  REALLOCATION_DISABLED,
  type AgentState as PlannerAgent,
  type EvaluationPlan,
  type ReallocationService,
  type ReallocationSwitch,
  type SettledDebit,
} from "@monadeum/reallocation";
import type { RiskService } from "@monadeum/risk";
import type { StrategyService } from "@monadeum/strategy";
import { runTick, type Observation, type TickMeasurement, type TickPorts, type TickResult, type TickStore } from "@monadeum/tick";
import { toCostedFill, type TradingService } from "@monadeum/trading";
import { PROVIDERS, type X402Client } from "@monadeum/x402";
import type { AgentRecord, AgentStore } from "./agents.js";
import type { ChainReader, MarketSource } from "./ports.js";

export interface WorkerSettings {
  /** Slippage bound written into every TradeIntent. */
  maxSlippageBps: number;
  /** The x402 resource for a pair, and the most the worker offers for it per tick, base units; null buys nothing. */
  information: { resource(pair: string): string; maxPrice: bigint } | null;
  /**
   * The reallocation switch (`loadReallocationSwitch` of `@monadeum/reallocation`). Omitted means off: the evaluation
   * then computes fitness and applies retirement, and plans and settles nothing.
   */
  reallocation?: ReallocationSwitch;
  clock(): Date;
}

export interface WorkerDependencies {
  agents: AgentStore;
  ticks: TickStore;
  chain: ChainReader;
  market: MarketSource;
  strategy: StrategyService;
  risk: RiskService;
  x402: X402Client;
  trading: TradingService;
  fitness: FitnessService;
  /** Constructed over the worker's RiskGatedSettlement, so every debit passes the RiskModule. */
  reallocation: ReallocationService;
  settings: WorkerSettings;
}

export interface FitnessRow {
  agentId: string;
  adjustedFitness: number | null;
  rawSortino: number | null;
  flaggedZeroDownside: boolean;
  tradeCount: number;
}

export interface EvaluationResult {
  sequence: number;
  fitness: FitnessRow[];
  retired: { agentId: string; reason: string }[];
  /** Whether this evaluation planned reallocation. When false, `plan` is empty and `settled` is empty. */
  reallocationEnabled: boolean;
  plan: EvaluationPlan;
  settled: SettledDebit[];
}

const units = (amount: bigint, decimals: number) => Number(amount) / 10 ** decimals;

/** The plan of an evaluation with reallocation off: nothing moves. */
const NOTHING_PLANNED: EvaluationPlan = { owners: [], moves: [], moved: 0 };

/** Active, with principal above 0. Agent creation writes principal 0; funding raises it (EVOLUTION.md section 1.1). */
const funded = (agent: AgentRecord) => agent.status === "active" && agent.principal > 0n;

/**
 * The agent worker loop over the real modules (ARCHITECTURE.md sections 4, 5, 11): StrategyService decides,
 * X402Client buys information within the RiskModule's caps, TradingService builds the plan, RiskService checks the
 * plan, TradingService submits the approved plan hash through WalletsTradeSigner by tick key, and fills feed
 * FitnessModule cost accounting. On the evaluation cadence it computes fitness, applies retirement, and, only while the
 * reallocation switch is on, plans reallocation and settles each source's debit through the RiskModule-gated settlement.
 *
 * Every piece of state lives behind a store, so a restarted worker is a new instance over the same stores.
 */
export class AgentWorker {
  constructor(private readonly deps: WorkerDependencies) {}

  /** Runs one tick for one agent. A retired agent does not tick, nor does an unfunded one (EVOLUTION.md section 1.1). */
  async tick(agentId: string, tick: number): Promise<TickResult | null> {
    const agent = await this.deps.agents.get(agentId);
    if (!agent || !funded(agent)) return null;
    return runTick(this.deps.ticks, agentId, tick, this.ports(agent));
  }

  /** Runs one tick for every active agent, then the evaluation when the tick is on the cadence. */
  async step(tick: number): Promise<{ ticks: TickResult[]; evaluation: EvaluationResult | null }> {
    const ticks: TickResult[] = [];
    for (const agent of await this.deps.agents.list()) {
      const result = await this.tick(agent.agentId, tick);
      if (result) ticks.push(result);
    }
    const evaluation = tick % EVALUATION_CADENCE === 0 ? await this.evaluate(tick) : null;
    return { ticks, evaluation };
  }

  /**
   * One evaluation (ARCHITECTURE.md section 5): fitness for every Active agent, population-wide; retirement; then the
   * owner-scoped reallocation plan, settled as one debit per source. Rerunning the same tick does not submit a debit
   * twice: the settlement refuses a key it has already seen.
   *
   * With the reallocation switch off (the default), the evaluation stops after retirement: no policy is read, nothing
   * is planned, and nothing reaches the settlement. Retirement still runs, because EVOLUTION.md section 6 makes it a
   * survival rule independent of reallocation, and it moves no capital (THREAT-MODEL.md invariant 15).
   */
  async evaluate(tick: number): Promise<EvaluationResult> {
    const { agents, fitness, reallocation, chain } = this.deps;
    const sequence = tick / EVALUATION_CADENCE;
    const decimals = await chain.decimals();
    const all = await agents.list();
    // An unfunded agent is not ranked, not a source or sink, and not retired for being below the capital floor.
    const active = all.filter(funded);
    const states = new Map(await Promise.all(active.map(async (a) => [a.agentId, await agents.state(a.agentId)] as const)));

    const window = (values: number[]) => values.slice(-fitness.trailingWindow);
    const raws = active
      .map((a) => sortinoParts(window(states.get(a.agentId)!.returns), window(states.get(a.agentId)!.tradeCounts)).raw)
      .filter((r): r is number => r !== null);
    const populationMedianSortino = median(raws);
    const rows: FitnessRow[] = active.map((a) => {
      const s = states.get(a.agentId)!;
      const r = fitness.evaluate({ returns: window(s.returns), tradeCounts: window(s.tradeCounts), populationMedianSortino, k: fitness.k });
      return { agentId: a.agentId, adjustedFitness: r.adjustedFitness, rawSortino: r.rawSortino, flaggedZeroDownside: r.flaggedZeroDownside, tradeCount: r.tradeCount };
    });
    const rowOf = new Map(rows.map((r) => [r.agentId, r]));

    // Retirement first: a retired agent is never a source or a sink (EVOLUTION.md section 3.1 item 7).
    const balances = new Map(await Promise.all(all.map(async (a) => [a.agentId, await chain.balanceOf(a.account)] as const)));
    const niche = (a: AgentRecord) => nicheKey(a.genome.assetUniverse, a.genome.riskTolerance);
    const retired: EvaluationResult["retired"] = [];
    for (const a of active) {
      const nicheFitness = active
        .filter((b) => niche(b) === niche(a))
        .map((b) => rowOf.get(b.agentId)!.adjustedFitness)
        .filter((f): f is number => f !== null);
      const s = states.get(a.agentId)!;
      const decision = reallocation.retirement({
        capital: units(balances.get(a.agentId)!, decimals),
        adjustedFitness: rowOf.get(a.agentId)!.adjustedFitness,
        nicheFitness,
        lowFitnessWindows: s.lowFitnessWindows,
      });
      await agents.saveState(a.agentId, { ...s, lowFitnessWindows: decision.lowFitnessWindows });
      if (decision.retire) {
        await agents.update({ ...a, status: "retired" });
        retired.push({ agentId: a.agentId, reason: decision.reason! });
      }
    }

    if (!(this.deps.settings.reallocation ?? REALLOCATION_DISABLED).enabled) {
      return { sequence, fitness: rows, retired, reallocationEnabled: false, plan: NOTHING_PLANNED, settled: [] };
    }

    const population: PlannerAgent[] = (await agents.list()).map((a) => ({
      id: a.agentId,
      owner: a.owner,
      status: a.status,
      capital: units(balances.get(a.agentId)!, decimals),
      principal: units(a.principal, decimals),
      adjustedFitness: rowOf.get(a.agentId)?.adjustedFitness ?? null,
      flaggedZeroDownside: rowOf.get(a.agentId)?.flaggedZeroDownside ?? false,
    }));
    const plan = reallocation.plan(tick, population);
    const settled = await reallocation.settle(sequence, plan, decimals);
    return { sequence, fitness: rows, retired, reallocationEnabled: true, plan, settled };
  }

  private ports(agent: AgentRecord): TickPorts {
    const { strategy, risk, x402, trading } = this.deps;
    return {
      observe: () => this.observe(agent),
      strategy,
      risk: { information: (r, l) => risk.information(r, l), trade: (p, plan, l) => risk.trade(p, plan, l) },
      x402: { buy: (p) => x402.buy(p), recordInfluence: (ref, i) => x402.recordInfluence(ref, i), spent: (p) => x402.spent(p) },
      trading: { prepare: (p) => trading.prepare(p), submit: (t, d) => trading.submit(t, d), reconcile: (k) => trading.reconcile(k) },
      measure: (m) => this.measure(agent, m),
    };
  }

  private async observe(agent: AgentRecord): Promise<Observation | null> {
    const { chain, market, agents, settings, trading } = this.deps;
    let decimals: number, capital: bigint, spentInWindow: bigint, reading, position;
    try {
      [decimals, capital, spentInWindow, reading, position] = await Promise.all([
        chain.decimals(), chain.balanceOf(agent.account), chain.windowTotal(agent.account), market.read(agent), trading.position(agent.agentId),
      ]);
    } catch {
      return null;
    }
    if (!reading || !Number.isFinite(reading.signal)) return null;
    const state = await agents.state(agent.agentId);
    const today = settings.clock().toISOString().slice(0, 10);
    const provider = agent.genome.informationSources.find((p) => (PROVIDERS as readonly string[]).includes(p));
    const info = settings.information;
    const maxPrice = info && agent.genome.informationBudget < info.maxPrice ? agent.genome.informationBudget : info?.maxPrice;
    return {
      symbol: reading.symbol,
      observedAt: reading.observedAt,
      view: {
        capital: units(capital, decimals),
        riskTolerance: agent.genome.riskTolerance,
        executionFrequency: agent.genome.executionFrequency,
        informationBudget: units(agent.genome.informationBudget, decimals),
        pair: agent.genome.pair,
        ticksSinceTrade: state.ticksSinceTrade,
        signal: reading.signal,
      },
      ledger: {
        capital,
        spentInWindow,
        informationBudget: agent.genome.informationBudget,
        informationToday: state.informationByDay[today] ?? 0n,
        informationThisTick: 0n,
        assetUniverse: [...agent.genome.assetUniverse],
      },
      account: agent.account,
      genomeHash: agent.genomeHash,
      principal: agent.principal,
      decimals,
      maxSlippageBps: settings.maxSlippageBps,
      position: position.size,
      offer: info && provider && maxPrice !== undefined && maxPrice > 0n
        ? { provider, resource: info.resource(agent.genome.pair), maxPrice }
        : null,
    };
  }

  /**
   * Cost accounting (EVOLUTION.md section 2.1): the trade's realized P&L (non-zero only for a close, from
   * TradingModule's position), its gas, fees, and slippage, and the x402 spend from X402Module become one FitnessModule
   * entry per tick. Unrealized P&L on an open position is not an input. The per-tick return is that net over the
   * agent's principal; Sortino is scale-free, so the denominator only fixes units. Idempotent by tick key, and
   * `settle` is idempotent by tick key, so a measurement replayed after a crash realizes nothing twice.
   */
  private async measure(agent: AgentRecord, m: TickMeasurement): Promise<void> {
    const { agents, fitness, chain, settings, trading } = this.deps;
    const state = await agents.state(agent.agentId);
    if (state.measured.includes(m.key)) return;
    const decimals = await chain.decimals();
    const entries: CostedFill[] = [];
    const realized = m.trade ? await trading.settle(m.trade) : 0n;
    const fill = m.trade ? toCostedFill(m.trade, decimals, realized) : null;
    if (fill) entries.push(fill);
    if (m.information > 0n) entries.push({ realizedPnl: 0, x402: units(m.information, decimals), gas: 0, fees: 0, slippage: 0 });
    const net = fitness.net(entries);
    const executed = m.outcome.kind === "executed";
    const today = settings.clock().toISOString().slice(0, 10);
    await agents.saveState(agent.agentId, {
      ...state,
      ticksSinceTrade: executed ? 0 : state.ticksSinceTrade + 1,
      informationByDay: { ...state.informationByDay, [today]: (state.informationByDay[today] ?? 0n) + m.information },
      returns: [...state.returns, net / units(agent.principal, decimals)],
      tradeCounts: [...state.tradeCounts, executed ? 1 : 0],
      measured: [...state.measured, m.key],
      net: state.net + net,
    });
  }
}
