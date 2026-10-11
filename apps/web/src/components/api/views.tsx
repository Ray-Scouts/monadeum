import { nicheKey } from "@monadeum/fitness/math";
import Link from "next/link";
import type { ReactNode } from "react";
import { FitnessBar } from "@/app/(app)/population/_components/AgentTable";
import { RiskBandBar } from "@/app/(app)/population/_components/NicheDiversity";
import { ShareBars } from "@/app/(app)/population/_components/X402Split";
import { Card, CardHead, Identicon, Kpi, Pill, ScreenHead, Sparkline, Tag } from "@/components/ui";
import {
  aboveOrAtPrincipal,
  agentNotServed,
  amount,
  DEPLOYMENT_LABEL,
  isRetired,
  plotValue,
  populationNotServed,
  providerName,
  reallocationEnabled,
  reallocationNote,
  sessionLabel,
  share,
  utc,
  type Explainer,
} from "@/data/api/present";
import type { AgentSpend, ApiAgent, CapitalFlowResponse, OwnerResponse, PopulationResponse, X402Totals } from "@/data/api/types";
import type { WebConfig } from "@/data/config";
import { shortAddress } from "@/lib/format";

// Presentational views of the API's answers. They take data as props and hold no state, so tests render them directly.

type Settlement = WebConfig["settlement"];

const TH = "whitespace-nowrap border-b border-line-soft px-2.5 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.08em] text-faint uppercase";
const TD = "whitespace-nowrap border-b border-line-soft px-2.5 py-2.5 align-middle";

export function LiveBadge() {
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-wash px-2.5 py-1 text-xs text-accent-hi">Live from the API</span>;
}

/** The deployment's reallocation switch as the API reports it in `GET /owners/me`; without an answer, off. */
export function ReallocationOffNote({ owner = null }: { owner?: OwnerResponse | null }) {
  return (
    <p role="note" className="rounded-xl border border-line-soft bg-surface-2 px-4 py-3 text-[13px] text-muted">
      {reallocationNote(owner)}
    </p>
  );
}

/** Names the fields the API does not serve yet, so their absence is stated rather than filled in. */
export function NotServed({ fields }: { fields: string[] }) {
  if (fields.length === 0) return null;
  return <p className="text-[13px] text-muted">Not served by the API yet, so not shown: {fields.join(", ")}.</p>;
}

/** Card body for a figure the API does not serve yet: stated as pending, never filled in. */
export function PendingBody({ children = "Not served by the API yet." }: { children?: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line-soft bg-surface-2 px-4 py-6 text-center text-[13px] text-muted">{children}</div>;
}

/** KPI value for a figure the API does not serve yet. */
const PENDING = <span className="text-[17px] font-medium text-faint">Pending</span>;
const PENDING_DETAIL = "Not served by the API yet";

/** Small figure in a table cell for a value the API does not serve yet. */
function PendingCell() {
  return (
    <span className="text-xs text-faint" title={PENDING_DETAIL}>
      Pending
    </span>
  );
}

/** Retired, flagged, the session key state, and unfunded, each only when the API reports it. */
function AgentPills({ agent }: { agent: ApiAgent }) {
  const s = sessionLabel(agent.session);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isRetired(agent) && <Pill tone="off">Retired</Pill>}
      {agent.zeroDownsideFlag === true && <Pill tone="warn">Flagged</Pill>}
      <Pill tone={s.tone}>{s.text}</Pill>
      {(agent.principal === null || agent.principal === "0") && <Pill tone="warn">Not funded, not trading</Pill>}
    </div>
  );
}

/** The agent's identicon, from its genome hash; without a committed genome, a neutral tile. */
function AgentMark({ agent, className }: { agent: ApiAgent; className?: string }) {
  if (agent.genome) return <Identicon agent={{ genome: agent.genome, status: isRetired(agent) ? "retired" : "active" }} className={className} />;
  return <span aria-hidden="true" className={`block flex-none bg-surface-2 ${className ?? "size-[30px] rounded-[9px]"}`} />;
}

function sparkColor(agent: ApiAgent): string {
  if (isRetired(agent)) return "var(--faint)";
  const above = aboveOrAtPrincipal(agent);
  return above === null ? "var(--accent)" : above ? "var(--good)" : "var(--bad)";
}

/** Capital after each recorded evaluation, when the API serves at least two points. */
function CapitalSpark({ agent, settlement, width, height }: { agent: ApiAgent; settlement: Settlement; width?: number; height?: number }) {
  const history = agent.capitalHistory;
  if (!history) return null;
  if (history.length < 2) return <span className="text-xs text-muted">{history.length === 1 ? "One evaluation" : "No evaluation yet"}</span>;
  const last = history[history.length - 1]!;
  return (
    <Sparkline
      values={history.map((h) => plotValue(h.capital, settlement))}
      width={width}
      height={height}
      color={sparkColor(agent)}
      label={`Capital after evaluations ${history[0]!.evaluation} to ${last.evaluation}, now ${amount(last.capital, settlement)}`}
    />
  );
}

export function AgentsTable({ agents, settlement }: { agents: ApiAgent[]; settlement: Settlement }) {
  if (agents.length === 0) return <p className="text-muted">You have no agents yet.</p>;
  const rows = [...agents].sort(
    (x, y) => Number(isRetired(x)) - Number(isRetired(y)) || (y.fitnessPercentile ?? -1) - (x.fitnessPercentile ?? -1),
  );
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Your agents</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>Agent</th>
            <th scope="col" className={TH}>Status</th>
            <th scope="col" className={`${TH} text-right`}>Capital</th>
            <th scope="col" className={TH}>Capital history</th>
            <th scope="col" className={TH}>Fitness (percentile)</th>
            <th scope="col" className={`${TH} text-right`}>Trades</th>
            <th scope="col" className={`${TH} text-right`}>Spent, indexed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="relative transition-colors hover:bg-surface-2 has-[a:focus-visible]:bg-surface-2">
              <td className={TD}>
                <div className="flex items-center gap-2.5">
                  <AgentMark agent={a} />
                  <div>
                    {/* The link covers the whole row so any cell opens the agent, while the row keeps a single tab stop. */}
                    <Link
                      href={`/agents/${encodeURIComponent(a.id)}`}
                      className="font-semibold after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent-hi"
                    >
                      {a.name}
                      <span className="sr-only">, open agent {a.id}</span>
                    </Link>
                    <small className="block font-mono text-xs text-faint">
                      {a.id} · {a.address ? shortAddress(a.address) : DEPLOYMENT_LABEL[a.deployment]}
                    </small>
                  </div>
                </div>
              </td>
              <td className={TD}>
                <AgentPills agent={a} />
              </td>
              <td className={`${TD} text-right font-mono tabular`}>{a.capital == null ? <PendingCell /> : amount(a.capital, settlement)}</td>
              <td className={TD}>{a.capitalHistory == null ? <PendingCell /> : <CapitalSpark agent={a} settlement={settlement} />}</td>
              <td className={TD}>
                <FitnessBar percentile={a.fitnessPercentile ?? null} />
              </td>
              <td className={`${TD} text-right font-mono tabular`}>{a.tradeCount == null ? <PendingCell /> : a.tradeCount}</td>
              <td className={`${TD} text-right font-mono tabular`}>{a.chain ? amount(a.chain.totalSpent, settlement) : "n/a"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The caller's live agents by risk band, from each committed genome, with the count of distinct niches (`nicheKey`). */
export function ApiNicheDiversity({ agents }: { agents: ApiAgent[] }) {
  const genomes = agents.filter((a) => !isRetired(a)).flatMap((a) => (a.genome ? [a.genome] : []));
  const niches = new Set(genomes.map((g) => nicheKey(g.assetUniverse, g.riskTolerance)));
  return (
    <Card>
      <CardHead title="Your agents by niche">
        <Tag>your agents only</Tag>
      </CardHead>
      <p className="mb-4 text-[13px] text-muted">
        Fitness and the starvation rule are measured within a niche: the asset universe and the risk band. This groups your live agents by risk band; other
        owners&apos; agents are not identified, so they are not counted here.
      </p>
      {genomes.length === 0 ? (
        <PendingBody>None of your live agents has a committed genome yet.</PendingBody>
      ) : (
        <>
          <RiskBandBar riskTolerances={genomes.map((g) => g.riskTolerance)} subject="Your live agents" />
          <p className="mt-3 text-xs text-muted">
            {niches.size} distinct {niches.size === 1 ? "niche" : "niches"} across {genomes.length} live {genomes.length === 1 ? "agent" : "agents"}.
          </p>
        </>
      )}
    </Card>
  );
}

const PROVIDER_COLORS = ["var(--berry)", "var(--accent)", "var(--sky)", "var(--mint)", "var(--sun)"] as const;

/** x402 spend by provider, from base-unit amounts. */
export function ApiX402Split({ x402, title, scope, settlement }: { x402: X402Totals | null | undefined; title: string; scope: string; settlement: Settlement }) {
  return (
    <Card>
      <CardHead title={title}>
        <Tag>{scope}</Tag>
      </CardHead>
      {x402 == null ? (
        <PendingBody />
      ) : x402.byProvider.length === 0 ? (
        <p className="text-sm text-muted">No x402 purchases recorded.</p>
      ) : (
        <div className="grid gap-3">
          <ShareBars
            of={title.toLowerCase()}
            items={x402.byProvider.map((p, i) => ({
              key: p.provider,
              name: providerName(p.provider),
              display: amount(p.spent, settlement),
              share: share(p.spent, x402.spent),
              color: PROVIDER_COLORS[i % PROVIDER_COLORS.length]!,
            }))}
          />
          <p className="text-xs text-muted">
            {x402.purchases} {x402.purchases === 1 ? "purchase" : "purchases"}, {amount(x402.spent, settlement)} in total.
          </p>
        </div>
      )}
    </Card>
  );
}

export function PopulationView({
  population,
  agents,
  owner = null,
  settlement,
}: {
  population: PopulationResponse;
  agents: ApiAgent[];
  owner?: OwnerResponse | null;
  settlement: Settlement;
}) {
  const last = population.lastEvaluation ?? null;
  return (
    <>
      <ScreenHead title="Population" aside={<LiveBadge />}>
        Platform totals across all owners, then your own agents. No other owner&apos;s agent is identified here. Fitness is a percentile within the
        agent&apos;s niche, adjusted for risk and for the amount of evidence, not raw profit.
      </ScreenHead>
      <section aria-label="Platform totals" className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Agents"
          value={population.agents}
          detail={`${population.accounts.deployed} of ${population.accounts.tracked} tracked accounts deployed, ${population.liveSessionKeys} live session keys`}
        />
        <Kpi
          label="Total capital"
          value={population.capital == null ? PENDING : <span className="text-[19px]">{amount(population.capital, settlement)}</span>}
          detail={population.capital == null ? PENDING_DETAIL : "Live agents at the last evaluation, all owners"}
        />
        <Kpi
          label="Trades"
          value={population.trades == null ? PENDING : population.trades}
          detail={population.trades == null ? PENDING_DETAIL : "All agents, all owners"}
        />
        <Kpi
          label="x402 spend"
          value={population.x402 == null ? PENDING : <span className="text-[19px]">{amount(population.x402.spent, settlement)}</span>}
          detail={population.x402 == null ? PENDING_DETAIL : `${population.x402.purchases} purchases, all owners`}
        />
        <Kpi
          label="Total spent"
          value={<span className="text-[19px]">{amount(population.totalSpent, settlement)}</span>}
          detail={population.cursor ? `Indexed spends, all owners, to block ${population.cursor.blockNumber}` : "The indexer has not recorded a block yet"}
        />
        <Kpi
          label="Last evaluation"
          value={last ? `#${last.sequence}` : PENDING}
          detail={last ? utc(last.at) : PENDING_DETAIL}
        />
      </section>
      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHead title="Your agents">
            <Tag>{agents.length} {agents.length === 1 ? "agent" : "agents"}</Tag>
          </CardHead>
          <AgentsTable agents={agents} settlement={settlement} />
        </Card>
        <div className="flex min-w-0 flex-col gap-4">
          <ApiNicheDiversity agents={agents} />
          <ApiX402Split x402={population.x402} title="x402 spend" scope="all owners, by provider" settlement={settlement} />
        </div>
      </div>
      <NotServed fields={populationNotServed(population, agents)} />
      <ReallocationOffNote owner={owner} />
    </>
  );
}

export function ExplainerCard({ explainer, owner = null }: { explainer: Explainer; owner?: OwnerResponse | null }) {
  return (
    <Card>
      <CardHead title="Reallocation and retirement">
        <Pill tone="off">{explainer.headline}</Pill>
      </CardHead>
      <ul className="m-0 grid list-disc gap-1.5 pl-5 text-sm">
        {explainer.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="mt-3">
        <ReallocationOffNote owner={owner} />
      </div>
    </Card>
  );
}

export function SpendsTable({ spends, settlement }: { spends: AgentSpend[]; settlement: Settlement }) {
  if (spends.length === 0) return <p className="text-sm text-muted">No spends indexed for this account yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={TH}>Block</th>
            <th className={TH}>Amount</th>
            <th className={TH}>24-hour total at that spend</th>
            <th className={TH}>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {spends.map((s) => (
            <tr key={`${s.transactionHash}-${s.blockNumber}-${s.amount}`}>
              <td className={`${TD} font-mono text-xs`}>{s.blockNumber}</td>
              <td className={`${TD} tabular`}>{amount(s.amount, settlement)}</td>
              <td className={`${TD} tabular`}>{amount(s.windowTotal, settlement)}</td>
              <td className={`${TD} font-mono text-xs`} title={s.transactionHash}>
                {shortAddress(s.transactionHash)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AgentFacts({ agent, settlement, actions }: { agent: ApiAgent; settlement: Settlement; actions?: ReactNode }) {
  const fitness = agent.fitnessPercentile ?? null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-5">
        <AgentMark agent={agent} className="size-[72px] rounded-[20px]" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[clamp(28px,3.4vw,40px)] font-bold break-all">{agent.name}</h1>
            <AgentPills agent={agent} />
            <LiveBadge />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
            <span>
              Agent ID <span className="font-mono text-fg">{agent.id}</span>
            </span>
            <span>
              Owner wallet <span className="font-mono text-fg break-all">{agent.owner}</span>
            </span>
            <span>
              {DEPLOYMENT_LABEL[agent.deployment]}
              {agent.address && (
                <>
                  : <span className="font-mono text-fg break-all">{agent.address}</span>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
      {actions}
      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi
          label="Capital"
          value={agent.capital == null ? PENDING : <span className="text-[19px]">{amount(agent.capital, settlement)}</span>}
          detail={`Principal ${agent.principal === null ? "not recorded" : amount(agent.principal, settlement)}`}
        />
        <Kpi
          label="Fitness"
          value={fitness === null ? PENDING : `P${Math.round(fitness)}`}
          detail={
            fitness === null
              ? "Not ranked yet"
              : `Percentile in its niche${agent.lowWindows == null ? "" : `, ${agent.lowWindows} low ${agent.lowWindows === 1 ? "window" : "windows"} in a row`}`
          }
        />
        <Kpi label="Trades" value={agent.tradeCount == null ? PENDING : agent.tradeCount} detail={agent.tradeCount == null ? PENDING_DETAIL : "Filled trades since creation"} />
        <Kpi
          label="x402 spend"
          value={agent.x402 == null ? PENDING : <span className="text-[19px]">{amount(agent.x402.spent, settlement)}</span>}
          detail={agent.x402 == null ? PENDING_DETAIL : `${agent.x402.purchases} ${agent.x402.purchases === 1 ? "purchase" : "purchases"}`}
        />
        <Kpi
          label="Spent, indexed"
          value={<span className="text-[19px]">{agent.chain ? amount(agent.chain.totalSpent, settlement) : "n/a"}</span>}
          detail={agent.chain ? "All indexed spends of the account" : "No account address yet"}
        />
      </section>
      <section aria-label="Limits and session key" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Per-transaction cap" value={<span className="text-[19px]">{amount(agent.limits.perTxCap, settlement)}</span>} detail="Enforced on chain" />
        <Kpi label="Daily cap" value={<span className="text-[19px]">{amount(agent.limits.dailyCap, settlement)}</span>} detail="Rolling 24 hours, on chain" />
        <Kpi
          label="Session key"
          value={<span className="text-[19px]">{agent.session ? agent.session.status : "none"}</span>}
          detail={agent.session ? <span className="font-mono">{shortAddress(agent.session.keyAddress)}</span> : "Not issued"}
        />
      </section>
    </>
  );
}

/** Capital after each recorded evaluation, or a pending body while the API does not serve the history. */
export function CapitalHistoryCard({ agent, settlement }: { agent: ApiAgent; settlement: Settlement }) {
  const history = agent.capitalHistory;
  return (
    <Card>
      <CardHead title="Capital history">{history && history.length > 0 && <Tag>{history.length} evaluations</Tag>}</CardHead>
      {history == null ? (
        <PendingBody />
      ) : history.length < 2 ? (
        <p className="text-sm text-muted">{history.length === 1 ? `One evaluation so far: ${amount(history[0]!.capital, settlement)}.` : "No evaluation recorded yet."}</p>
      ) : (
        <div className="overflow-hidden">
          <CapitalSpark agent={agent} settlement={settlement} width={300} height={80} />
        </div>
      )}
    </Card>
  );
}

/** What the agent's answer leaves null or missing, named once. */
export function AgentNotServed({ agent }: { agent: ApiAgent }) {
  return <NotServed fields={agentNotServed(agent)} />;
}

export function CapitalFlowView({ flow, agents, owner, settlement }: { flow: CapitalFlowResponse; agents: ApiAgent[]; owner: OwnerResponse | null; settlement: Settlement }) {
  const name = new Map(agents.map((a) => [a.id, a.name]));
  const total = flow.spends.reduce((sum, s) => sum + (/^\d+$/.test(s.amount) ? BigInt(s.amount) : 0n), 0n);
  return (
    <>
      <ScreenHead title="Capital flow" aside={<LiveBadge />}>
        Your capital: what moved between your agents through reallocation, and what each agent spent on chain.
      </ScreenHead>
      <ReallocationOffNote owner={owner} />
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Your agents" value={agents.length} />
        {reallocationEnabled(owner) ? (
          <Kpi
            label="Policy"
            value={owner?.policy ? <Pill tone="accent">Signed, sequence {owner.policy.sequence}</Pill> : <Pill tone="off">None</Pill>}
            detail={owner?.policy ? "Recorded by the API" : "Reallocation is off for you"}
          />
        ) : (
          <Kpi label="Reallocation" value={<Pill tone="off">Off</Pill>} detail="Off for every agent on this deployment" />
        )}
        <Kpi label="Spent, indexed" value={<span className="text-[19px]">{amount(total.toString(), settlement)}</span>} detail={`${flow.spends.length} spends across your agents`} />
      </section>
      <Card>
        <CardHead title="Reallocations" />
        {flow.reallocationsIndexed ? (
          flow.reallocations.length === 0 ? (
            <p className="text-sm text-muted">No reallocation has moved your capital.</p>
          ) : (
            <p className="text-sm text-muted">{flow.reallocations.length} reallocations are indexed; this page does not display them yet.</p>
          )
        ) : (
          <p className="text-sm text-muted">
            Reallocations are not indexed yet: the reallocation contract is not deployed, so the API cannot report whether any capital moved between your agents.
            An empty list here does not mean nothing moved.
          </p>
        )}
      </Card>
      <Card>
        <CardHead title="Spends" />
        {flow.spends.length === 0 ? (
          <p className="text-sm text-muted">No spends indexed for your agents yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={TH}>Agent</th>
                  <th className={TH}>Block</th>
                  <th className={TH}>Amount</th>
                  <th className={TH}>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {flow.spends.map((s) => (
                  <tr key={`${s.transactionHash}-${s.agentId}-${s.amount}`}>
                    <td className={TD}>
                      <Link href={`/agents/${encodeURIComponent(s.agentId)}`} className="text-accent-hi hover:underline">
                        {name.get(s.agentId) ?? s.agentId}
                      </Link>
                    </td>
                    <td className={`${TD} font-mono text-xs`}>{s.blockNumber}</td>
                    <td className={`${TD} tabular`}>{amount(s.amount, settlement)}</td>
                    <td className={`${TD} font-mono text-xs`} title={s.transactionHash}>
                      {shortAddress(s.transactionHash)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** For a screen whose data the API does not serve yet. */
export function NotServedScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <ScreenHead title={title} />
      <Card>
        <p className="text-sm text-muted">{children}</p>
      </Card>
    </>
  );
}
