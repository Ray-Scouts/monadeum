import { createExecutionBackend, DEFAULT_COSTS } from "./execution.js";
import { createFitnessModule, sortinoParts } from "./fitness.js";
import { assertGenomeModel, genomeDistance, genomeEdge, randomGenome } from "./genome-model.js";
import { generateMarket } from "./market.js";
import { planReallocation, reallocationQuota } from "./reallocation.js";
import { experimentPopulationCap, PROTOCOL } from "./protocol.js";
import { createReproductionModule, median, nicheKey, nichePressure, percentile } from "./reproduction.js";
import { createRiskModule } from "./risk.js";
import { saltedRng } from "./rng.js";
import { propose } from "./strategy.js";
import type {
  AgentSnapshot,
  AgentSummary,
  CostLedger,
  CostModel,
  GateCounts,
  Genome,
  GenomeTracePoint,
  RunConfig,
  RunResult,
  SlotLedger,
} from "./types.js";

interface Agent {
  id: string;
  genome: Genome;
  capital: number;
  principal: number;
  status: "active" | "retired";
  trades: number;
  lastTradeTick: number;
  lastReproductionTick: number;
  birthTick: number;
  descendants: number;
  returns: number[];
  tradeMarks: number[];
  flaggedZeroDownside: boolean;
  adjustedFitness: number | null;
  rawSortino: number | null;
  lowFitnessWindows: number;
  skill: number;
  /** Per-tick edge from the genome under `RunConfig.genomeModel`, 0 when the model is off. */
  genomeEdge: number;
  infoThisTick: boolean;
  parent: string | null;
  /** Owner index under `slots.owners` (issue #89), -1 otherwise. */
  owner: number;
  /** Net capital received by reallocation (issue #89 bookkeeping, reported only under `slots.owners`). */
  reallocatedIn: number;
  /** Net trading P&L minus costs (issue #89 bookkeeping, reported only under `slots.owners`). */
  tradingNet: number;
}

/** Ticks between points of `RunResult.genomeTrace`. */
export const GENOME_TRACE_EVERY = 60;

const DEFAULT_GENOME: Genome = {
  strategyType: "trading",
  assetUniverse: ["PAIR_A"],
  riskTolerance: 0.1,
  executionFrequency: 5,
  timeHorizon: 20,
  entryThreshold: 0,
  exitThreshold: 0,
  informationSources: ["nansen"],
  informationBudget: 0.05,
  modelConfiguration: "low",
};

function snapshot(agent: Agent, nowTick: number): AgentSnapshot {
  return {
    id: agent.id,
    capital: agent.capital,
    principal: agent.principal,
    adjustedFitness: agent.adjustedFitness,
    rawSortino: agent.rawSortino,
    flaggedZeroDownside: agent.flaggedZeroDownside,
    tradeCount: agent.tradeMarks.reduce((sum, mark) => sum + mark, 0),
    status: agent.status,
    descendants: agent.descendants,
    ticksSinceReproduction: nowTick - Math.max(agent.lastReproductionTick, agent.birthTick),
    genome: agent.genome,
  };
}

function pushWindow(agent: Agent, value: number, traded: boolean): void {
  agent.returns.push(value);
  agent.tradeMarks.push(traded ? 1 : 0);
  const extra = agent.returns.length - PROTOCOL.trailingWindow;
  if (extra > 0) {
    agent.returns.splice(0, extra);
    agent.tradeMarks.splice(0, extra);
  }
}

export function gini(values: readonly number[]): number {
  const sorted = values.filter((value) => value >= 0).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const sum = sorted.reduce((total, value) => total + value, 0);
  if (sum === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * (sorted[i] ?? 0);
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

export function run(config: RunConfig): RunResult {
  const costs: CostModel = { ...DEFAULT_COSTS, ...config.costs };
  const fitness = config.fitness ?? createFitnessModule();
  const reproduction = config.reproduction ?? createReproductionModule();
  const risk = config.risk ?? createRiskModule();
  const execution = config.execution ?? createExecutionBackend();
  const principal = config.principal ?? PROTOCOL.principal;
  const baseGenome = risk.clipGenome({ ...DEFAULT_GENOME, ...config.genome });
  const marketRng = saltedRng(config.seed, 1);
  const agentRng = saltedRng(config.seed, 2);
  const bars = generateMarket(config.regime, config.ticks, marketRng);
  const cap = experimentPopulationCap(config.population);
  const diversity = config.diversity !== false;
  const informationPurchases = config.informationPurchases !== false;
  const heritability = config.skillHeritability ?? 0;
  if (!(heritability >= 0 && heritability <= 1)) {
    throw new RangeError(`skillHeritability must be in [0, 1], got ${heritability}`);
  }
  const reproductionFraction = config.reproductionFraction ?? PROTOCOL.reproductionFraction;
  if (!(reproductionFraction > 0 && reproductionFraction <= 1)) {
    throw new RangeError(`reproductionFraction must be in (0, 1], got ${reproductionFraction}`);
  }
  const minChildCapital = config.minChildCapital ?? 0;
  const treasuryStart = config.treasury ?? 0;
  if (!(Number.isFinite(minChildCapital) && minChildCapital >= 0)) {
    throw new RangeError(`minChildCapital must be a finite number >= 0, got ${minChildCapital}`);
  }
  if (!(Number.isFinite(treasuryStart) && treasuryStart >= 0)) {
    throw new RangeError(`treasury must be a finite number >= 0, got ${treasuryStart}`);
  }
  // Experiment-only treasury (issue #82). In evolving mode it tops children up to minChildCapital. In static mode it
  // is never spent, so both modes start and are measured on the same total capital.
  const treasury = { initial: treasuryStart, remaining: treasuryStart, spent: 0, topUps: 0 };
  // Experiment-only genome performance model (issue #84). Off by default, which leaves every code path below as it was.
  const genomeModel = config.genomeModel;
  if (genomeModel) assertGenomeModel(genomeModel);
  const edgeOf = (genome: Genome): number => (genomeModel ? genomeEdge(genome, config.regime, genomeModel) : 0);
  // Separate stream so drawing random founders leaves the market and agent streams unchanged.
  const genomeRng = saltedRng(config.seed, 3);
  // Experiment-only fixed slots (issue #85). Their own stream, so every arm shares founders and information draws.
  const slotConfig = config.mode === "slots" ? config.slots : undefined;
  if (config.mode === "slots") {
    if (!slotConfig || !["random", "mutant", "none", "retire"].includes(slotConfig.refill)) {
      throw new RangeError("slots mode needs RunConfig.slots with refill 'random', 'mutant', 'none', or 'retire'");
    }
    if (slotConfig.owners !== undefined) {
      const sizes = slotConfig.owners;
      if (!sizes.every((size) => Number.isInteger(size) && size >= 1)) {
        throw new RangeError("slots.owners must be integers >= 1");
      }
      const total = sizes.reduce((sum, size) => sum + size, 0);
      if (total !== config.population) {
        throw new RangeError(`slots.owners must sum to the population ${config.population}, got ${total}`);
      }
    }
    if (slotConfig.donorScope !== undefined && !["population", "owner"].includes(slotConfig.donorScope)) {
      throw new RangeError(`slots.donorScope must be 'population' or 'owner', got ${String(slotConfig.donorScope)}`);
    }
    if (slotConfig.donorScope === "owner" && slotConfig.owners === undefined) {
      throw new RangeError("slots.donorScope 'owner' needs slots.owners");
    }
    const cap = slotConfig.reallocationCap ?? 0;
    if (!(cap >= 0 && cap <= 1)) throw new RangeError(`slots.reallocationCap must be in [0, 1], got ${cap}`);
    const ceiling = slotConfig.slotCeiling;
    if (cap > 0 && !(ceiling !== undefined && Number.isFinite(ceiling) && ceiling >= 1)) {
      throw new RangeError(`slots.slotCeiling must be a finite multiple >= 1 when reallocating, got ${String(ceiling)}`);
    }
  }
  const slotRng = saltedRng(config.seed, 4);
  const slotLedger: SlotLedger = { replacements: 0, noDonor: 0, capitalMoved: 0, reallocations: 0 };
  const bandMids = [0.03, 0.07, 0.12, 0.17, 0.22];
  const pairSets = [["PAIR_A"], ["PAIR_B"], ["PAIR_C"], ["PAIR_A", "PAIR_B"], ["PAIR_A", "PAIR_C"]];
  const startingGenome = (index: number): Genome => {
    if (config.randomGenomes) return randomGenome(genomeRng, baseGenome, risk);
    if (!config.spreadNiches) {
      return {
        ...baseGenome,
        assetUniverse: [...baseGenome.assetUniverse],
        informationSources: [...baseGenome.informationSources],
      };
    }
    return risk.clipGenome({
      ...baseGenome,
      riskTolerance: bandMids[index % bandMids.length] ?? 0.1,
      assetUniverse: [...(pairSets[index % pairSets.length] ?? ["PAIR_A"])],
      informationSources: [...baseGenome.informationSources],
    });
  };

  // Issue #89 ownership partition: slot i belongs to the owner whose run of sizes covers it.
  const owners = slotConfig?.owners;
  const ownerOfSlot: number[] = [];
  owners?.forEach((size, owner) => {
    for (let j = 0; j < size; j++) ownerOfSlot.push(owner);
  });

  const agents: Agent[] = [];
  for (let i = 0; i < config.population; i++) {
    const genome = startingGenome(i);
    // The skill draw is always made so the agent RNG stream does not depend on the genome model.
    const skill = -0.002 + agentRng() * 0.006;
    agents.push({
      id: `a${String(i).padStart(4, "0")}`,
      genome,
      capital: principal,
      principal,
      status: "active",
      trades: 0,
      lastTradeTick: -1,
      lastReproductionTick: -1,
      birthTick: 0,
      descendants: 0,
      returns: [],
      tradeMarks: [],
      flaggedZeroDownside: false,
      adjustedFitness: null,
      rawSortino: null,
      lowFitnessWindows: 0,
      skill: genomeModel ? 0 : skill,
      genomeEdge: edgeOf(genome),
      infoThisTick: false,
      parent: null,
      owner: ownerOfSlot[i] ?? -1,
      reallocatedIn: 0,
      tradingNet: 0,
    });
  }

  const ledger: CostLedger = { gas: 0, x402: 0, fees: 0, slippage: 0, grossPnl: 0 };
  const portfolioReturns: number[] = [];
  let reproductions = 0;
  const gates: GateCounts = { evaluations: 0, failed: {}, sole: {} };
  const countGates = (failed: readonly string[]): void => {
    gates.evaluations += 1;
    for (const gate of failed) gates.failed[gate] = (gates.failed[gate] ?? 0) + 1;
    const only = failed[0];
    if (failed.length === 1 && only !== undefined) gates.sole[only] = (gates.sole[only] ?? 0) + 1;
  };
  let nextChild = 0;
  const marketReturns: number[] = [];
  const genomeTrace: GenomeTracePoint[] = [];
  const traceGenomes = (tick: number): void => {
    let capital = 0;
    let weighted = 0;
    let sum = 0;
    let count = 0;
    for (const agent of agents) {
      if (agent.status !== "active") continue;
      const distance = genomeDistance(agent.genome, config.regime);
      capital += agent.capital;
      weighted += agent.capital * distance;
      sum += distance;
      count += 1;
    }
    genomeTrace.push({ tick, weighted: capital > 0 ? weighted / capital : 0, mean: count > 0 ? sum / count : 0 });
  };
  if (genomeModel) traceGenomes(0);

  /**
   * Issue #85 replacement. Each starved slot keeps its account, capital, and principal, and receives a new genome: a
   * random one, or a section 3.3 mutation of a donor drawn uniformly from the active agents that would pass the section
   * 3.1 fitness gates (no zero-downside flag, `N_min` trades, niche percentile at or above the section 5 requirement,
   * which rises to the 75th percentile in a crowded niche, where `p_mut` also doubles). The capital gates do not apply,
   * because replacement moves no capital. The slot's fitness history restarts, as a child's would.
   */
  const replaceSlots = (starved: Agent[], active: Agent[], matesOf: (agent: Agent) => Agent[], tick: number): void => {
    // With refill "none" (issue #89) a triggered slot keeps its genome, its history, and its capital.
    if (!slotConfig || slotConfig.refill === "none" || starved.length === 0) return;
    const starvedSet = new Set(starved);
    const ownerDonors = slotConfig.donorScope === "owner";
    const donors: { agent: Agent; pMut: number }[] = [];
    if (slotConfig.refill === "mutant") {
      for (const agent of active) {
        if (starvedSet.has(agent) || agent.adjustedFitness === null || agent.flaggedZeroDownside) continue;
        if (agent.tradeMarks.reduce((sum, mark) => sum + mark, 0) < PROTOCOL.nMin) continue;
        const mates = matesOf(agent);
        const pressure = nichePressure(active.length === 0 ? 0 : mates.length / active.length, diversity);
        const scores = mates.map((item) => item.adjustedFitness).filter((value): value is number => value !== null);
        if (percentile(agent.adjustedFitness, scores) < pressure.requiredPercentile) continue;
        donors.push({ agent, pMut: pressure.pMut });
      }
    }
    for (const slot of starved) {
      let genome: Genome;
      let parent: string | null = null;
      if (slotConfig.refill === "random") {
        genome = randomGenome(slotRng, baseGenome, risk);
      } else {
        // Issue #89: with donor scope "owner", only eligible slots with the same owner can donate.
        const pool = ownerDonors ? donors.filter((item) => item.agent.owner === slot.owner) : donors;
        if (pool.length === 0) {
          slotLedger.noDonor += 1;
          continue;
        }
        const donor = pool[Math.min(pool.length - 1, Math.floor(slotRng() * pool.length))];
        if (!donor) continue;
        genome = reproduction.mutate({ genome: donor.agent.genome, rng: slotRng, pMut: donor.pMut });
        donor.agent.descendants += 1;
        parent = donor.agent.id;
      }
      slot.genome = genome;
      slot.genomeEdge = edgeOf(genome);
      slot.parent = parent;
      slot.birthTick = tick;
      slot.returns = [];
      slot.tradeMarks = [];
      slot.flaggedZeroDownside = false;
      slot.adjustedFitness = null;
      slot.rawSortino = null;
      slot.lowFitnessWindows = 0;
      slotLedger.replacements += 1;
    }
  };

  /**
   * Issue #85 bounded reallocation. Active slots with a fitness are ranked by adjusted fitness. Each bottom-decile slot
   * offers `reallocationCap` of its capital, never going below the capital floor. The top-decile slots take the offers,
   * each up to `slotCeiling` times its principal. When the room is smaller than the offers, every offer is scaled down
   * by the same factor. Total capital is unchanged: the debits and credits are the same amount.
   */
  const reallocate = (): void => {
    const cap = slotConfig?.reallocationCap ?? 0;
    const ceiling = slotConfig?.slotCeiling ?? 1;
    if (cap <= 0) return;
    const ranked = agents
      .filter((agent) => agent.status === "active" && agent.adjustedFitness !== null)
      .sort((a, b) => (b.adjustedFitness ?? 0) - (a.adjustedFitness ?? 0) || (a.id < b.id ? -1 : 1));
    // Issue #85 ranks one population-wide pool. Issue #89 ranks each owner's slots as its own pool, in the same order.
    const pools: Agent[][] = [];
    if (owners) {
      const byOwner = new Map<number, Agent[]>();
      for (const agent of ranked) {
        const pool = byOwner.get(agent.owner);
        if (pool) pool.push(agent);
        else byOwner.set(agent.owner, [agent]);
      }
      pools.push(...[...byOwner.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]));
    } else {
      pools.push(ranked);
    }
    let movedThisEvaluation = 0;
    for (const pool of pools) {
      const q = reallocationQuota(pool.length, owners !== undefined);
      if (q < 1) continue;
      const sinks = pool.slice(0, q);
      const sources = pool.slice(pool.length - q);
      const plan = planReallocation(
        sources.map((slot) => slot.capital),
        sinks.map((slot) => ({ capital: slot.capital, principal: slot.principal })),
        cap,
        ceiling,
        PROTOCOL.capitalFloor,
      );
      if (!(plan.moved > 0)) continue;
      sources.forEach((slot, index) => {
        const debit = plan.debits[index] ?? 0;
        slot.capital -= debit;
        slot.reallocatedIn -= debit;
      });
      sinks.forEach((slot, index) => {
        const credit = plan.credits[index] ?? 0;
        slot.capital += credit;
        slot.reallocatedIn += credit;
      });
      movedThisEvaluation += plan.moved;
    }
    if (!(movedThisEvaluation > 0)) return;
    slotLedger.capitalMoved += movedThisEvaluation;
    slotLedger.reallocations += 1;
  };

  for (const bar of bars) {
    let capitalBefore = 0;
    let netPortfolio = 0;
    for (const agent of agents) {
      if (agent.status !== "active") continue;
      capitalBefore += agent.capital;
      const before = agent.capital;
      let traded = false;
      let net = 0;
      agent.infoThisTick = false;
      // Draw before checking the switch so turning purchases off leaves the agent RNG stream unchanged.
      const infoDraw = agentRng();
      if (
        informationPurchases &&
        infoDraw < costs.infoPurchaseProbability &&
        costs.x402Usd <= agent.genome.informationBudget &&
        agent.capital > costs.x402Usd
      ) {
        agent.capital -= costs.x402Usd;
        ledger.x402 += costs.x402Usd;
        net -= costs.x402Usd;
        agent.infoThisTick = true;
      }
      // With the model off the base edge is the hidden skill, exactly as before issue #84.
      const base = genomeModel ? agent.genomeEdge : agent.skill;
      const edge = base + (agent.infoThisTick ? costs.infoEdge : 0);
      if (risk.allowsTrade(bar.tick, agent.lastTradeTick, agent.genome)) {
        const proposal = propose({ marketReturns, genome: agent.genome, edge });
        if (proposal) {
          const notional = Math.min(risk.positionNotional(agent.capital, agent.genome), agent.capital);
          const estimatedCost = notional * ((costs.feeBps + costs.slippageBps) / 10_000) + costs.gasUsd;
          if (notional > 0 && agent.capital > estimatedCost) {
            const fill = execution.execute({ notional, edge, pair: proposal.pair }, bar, costs);
            const cost = fill.fee + fill.slippage + fill.gas;
            agent.capital += fill.pnl - cost;
            ledger.grossPnl += fill.pnl;
            ledger.fees += fill.fee;
            ledger.slippage += fill.slippage;
            ledger.gas += fill.gas;
            net += fill.pnl - cost;
            agent.trades += 1;
            agent.lastTradeTick = bar.tick;
            traded = true;
          }
        }
      }
      if (agent.capital < PROTOCOL.capitalFloor) agent.status = "retired";
      const denom = before > 0 ? before : 1;
      pushWindow(agent, (agent.capital - before) / denom, traded);
      netPortfolio += agent.capital - before;
      agent.tradingNet += net;
    }
    marketReturns.push(bar.ret);
    portfolioReturns.push(capitalBefore > 0 ? netPortfolio / capitalBefore : 0);

    if (bar.tick % PROTOCOL.evalEvery === 0) {
      const raws: number[] = [];
      const parts = agents.map((agent) => sortinoParts(agent.returns, agent.tradeMarks));
      for (const part of parts) {
        if (!part.flagged && part.raw !== null) raws.push(part.raw);
      }
      const populationMedian = median(raws);
      agents.forEach((agent, index) => {
        const part = parts[index];
        if (!part) return;
        const result = fitness.evaluate({
          returns: agent.returns,
          tradeCounts: agent.tradeMarks,
          populationMedianSortino: populationMedian,
          k: PROTOCOL.k,
        });
        agent.flaggedZeroDownside = result.flaggedZeroDownside;
        agent.adjustedFitness = result.adjustedFitness;
        agent.rawSortino = result.rawSortino;
      });

      const active = agents.filter((agent) => agent.status === "active");
      const matesOf = (agent: Agent): Agent[] => {
        if (!diversity) return active;
        const key = nicheKey(agent.genome);
        const mates = active.filter((item) => nicheKey(item.genome) === key);
        return mates.length > 0 ? mates : active;
      };
      const starved: Agent[] = [];
      for (const agent of active) {
        if (agent.adjustedFitness === null) continue;
        const scores = matesOf(agent)
          .map((item) => item.adjustedFitness)
          .filter((value): value is number => value !== null);
        const rank = percentile(agent.adjustedFitness, scores);
        if (rank <= 0.1) agent.lowFitnessWindows += 1;
        else agent.lowFitnessWindows = 0;
        if (agent.lowFitnessWindows >= PROTOCOL.retirementWindows) {
          // In slots mode the starvation rule of section 6 is a replacement trigger, not a retirement (issue #85).
          // With refill "retire" (issue #89 diagnostic) the slot retires as in a static run and keeps its capital idle.
          if (slotConfig && slotConfig.refill !== "retire") starved.push(agent);
          else agent.status = "retired";
        }
      }

      if (slotConfig) {
        replaceSlots(starved, active, matesOf, bar.tick);
        reallocate();
      }

      if (config.mode === "evolving") {
        const ordered = [...agents].sort((a, b) => {
          const fb = b.adjustedFitness ?? -Infinity;
          const fa = a.adjustedFitness ?? -Infinity;
          if (fb !== fa) return fb - fa;
          return a.id < b.id ? -1 : 1;
        });
        for (const parent of ordered) {
          if (agents.length >= cap) break;
          const mates = matesOf(parent);
          const share = active.length === 0 ? 0 : mates.length / active.length;
          const pressure = nichePressure(share, diversity);
          const decision = reproduction.evaluate({
            agent: snapshot(parent, bar.tick),
            reference: mates.map((agent) => snapshot(agent, bar.tick)),
            populationSize: agents.length,
            populationCap: cap,
            nowTick: bar.tick,
            requiredPercentile: pressure.requiredPercentile,
          });
          // Allocation is a pure function of the parent's balance, so computing it for every parent changes nothing
          // when the eligibility gates fail. It lets the minimum child capital gate be counted beside them.
          const allocation = reproduction.allocate({
            capital: parent.capital,
            principal: parent.principal,
            fraction: reproductionFraction,
            maxChildCapital: parent.principal,
          });
          const funded = allocation.childCapital > 0 && allocation.parentCapitalAfter >= parent.principal;
          // Top-up to minChildCapital from the treasury, all or nothing. When the treasury cannot cover it, the child
          // must be funded to minChildCapital from profit alone, which is the plain minimum child capital gate.
          const shortfall = Math.max(0, minChildCapital - allocation.childCapital);
          const topUp = shortfall > 0 && shortfall <= treasury.remaining ? shortfall : 0;
          const belowMinimum = allocation.childCapital + topUp < minChildCapital;
          let failed: string[];
          if (!decision.eligible) failed = belowMinimum ? [...decision.failed, "min_child_capital"] : decision.failed;
          else if (!funded) failed = ["allocation"];
          else failed = belowMinimum ? ["min_child_capital"] : [];
          if (parent.status === "active") countGates(failed);
          if (!decision.eligible || !funded || belowMinimum) continue;
          if (topUp > 0) {
            treasury.remaining -= topUp;
            treasury.spent += topUp;
            treasury.topUps += 1;
          }
          const childCapital = allocation.childCapital + topUp;
          parent.capital = allocation.parentCapitalAfter;
          parent.descendants += 1;
          parent.lastReproductionTick = bar.tick;
          const childGenome = reproduction.mutate({
            genome: parent.genome,
            rng: agentRng,
            pMut: pressure.pMut,
          });
          // Same draw, in the same order, as before heritability existed, so h = 0 leaves the RNG stream unchanged.
          const freshSkill = -0.002 + agentRng() * 0.006;
          agents.push({
            id: `c${String(nextChild).padStart(4, "0")}`,
            genome: childGenome,
            capital: childCapital,
            principal: childCapital,
            status: "active",
            trades: 0,
            lastTradeTick: -1,
            lastReproductionTick: -1,
            birthTick: bar.tick,
            descendants: 0,
            returns: [],
            tradeMarks: [],
            flaggedZeroDownside: false,
            adjustedFitness: null,
            rawSortino: null,
            lowFitnessWindows: 0,
            skill: genomeModel ? 0 : heritability * parent.skill + (1 - heritability) * freshSkill,
            genomeEdge: edgeOf(childGenome),
            infoThisTick: false,
            parent: parent.id,
            owner: -1,
            reallocatedIn: 0,
            tradingNet: 0,
          });
          nextChild += 1;
          reproductions += 1;
        }
      }
    }
    if (genomeModel && bar.tick % GENOME_TRACE_EVERY === 0) traceGenomes(bar.tick);
  }

  const populationSortino = sortinoParts(portfolioReturns, portfolioReturns.map(() => 1));
  const livingCapital = agents.map((agent) => agent.capital);
  // The treasury balance counts toward total capital in both modes, so ROI is measured over the same base.
  const totalCapital = livingCapital.reduce((sum, value) => sum + value, 0) + treasury.remaining;
  const startingCapital = config.population * principal + treasury.initial;
  const summaries: AgentSummary[] = agents
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((agent) => ({
      id: agent.id,
      capital: agent.capital,
      principal: agent.principal,
      trades: agent.trades,
      flaggedZeroDownside: agent.flaggedZeroDownside,
      status: agent.status,
      descendants: agent.descendants,
      niche: nicheKey(agent.genome),
      skill: agent.skill,
      parent: agent.parent,
      ...(genomeModel ? { genomeDistance: genomeDistance(agent.genome, config.regime) } : {}),
      ...(owners ? { owner: agent.owner, reallocatedIn: agent.reallocatedIn, tradingNet: agent.tradingNet } : {}),
    }));

  return {
    seed: config.seed,
    regime: config.regime,
    mode: config.mode,
    population: config.population,
    ticks: config.ticks,
    endPopulation: agents.length,
    totalCapital,
    startingCapital,
    roiPct: ((totalCapital - startingCapital) / startingCapital) * 100,
    sortino: populationSortino.flagged ? null : populationSortino.raw,
    gini: gini(livingCapital),
    reproductions,
    gates,
    treasury,
    ledger,
    prices: bars.map((bar) => bar.price),
    agents: summaries,
    ...(slotConfig ? { slots: slotLedger } : {}),
    ...(genomeModel ? { genomeTrace } : {}),
  };
}
