import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardHead, Kpi, Pill, ScreenHead } from "@/components/ui";
import { amount, DEPLOYMENT_LABEL, REALLOCATION_OFF, sessionLabel, type Explainer } from "@/data/api/present";
import type { AgentSpend, ApiAgent, CapitalFlowResponse, OwnerResponse, PopulationResponse } from "@/data/api/types";
import type { WebConfig } from "@/data/config";
import { shortAddress } from "@/lib/format";

// Presentational views of the API's answers. They take data as props and hold no state, so tests render them directly.

type Settlement = WebConfig["settlement"];

const TH = "whitespace-nowrap border-b border-line-soft px-2.5 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.08em] text-faint uppercase";
const TD = "whitespace-nowrap border-b border-line-soft px-2.5 py-2.5 align-middle";

export function LiveBadge() {
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-wash px-2.5 py-1 text-xs text-accent-hi">Live from the API</span>;
}

export function ReallocationOffNote() {
  return (
    <p role="note" className="rounded-xl border border-line-soft bg-surface-2 px-4 py-3 text-[13px] text-muted">
      {REALLOCATION_OFF}
    </p>
  );
}

/** Names the fields the API does not serve yet, so their absence is stated rather than filled in. */
export function NotServed({ fields }: { fields: string[] }) {
  if (fields.length === 0) return null;
  return <p className="text-[13px] text-muted">Not served by the API yet, so not shown: {fields.join(", ")}.</p>;
}

export function AgentsTable({ agents, settlement }: { agents: ApiAgent[]; settlement: Settlement }) {
  if (agents.length === 0) return <p className="text-muted">You have no agents yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={TH}>Agent</th>
            <th className={TH}>Status</th>
            <th className={TH}>Account</th>
            <th className={TH}>Per-transaction cap</th>
            <th className={TH}>Daily cap</th>
            <th className={TH}>Spent, indexed</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => {
            const s = sessionLabel(a.session);
            return (
              <tr key={a.id}>
                <td className={TD}>
                  <Link href={`/agents/${encodeURIComponent(a.id)}`} className="font-semibold text-accent-hi hover:underline">
                    {a.name}
                  </Link>
                </td>
                <td className={TD}>
                  <Pill tone={s.tone}>{s.text}</Pill>
                </td>
                <td className={`${TD} font-mono text-xs`}>{a.address ? shortAddress(a.address) : DEPLOYMENT_LABEL[a.deployment]}</td>
                <td className={`${TD} tabular`}>{amount(a.limits.perTxCap, settlement)}</td>
                <td className={`${TD} tabular`}>{amount(a.limits.dailyCap, settlement)}</td>
                <td className={`${TD} tabular`}>{a.chain ? amount(a.chain.totalSpent, settlement) : "n/a"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PopulationView({ population, agents, settlement }: { population: PopulationResponse; agents: ApiAgent[]; settlement: Settlement }) {
  return (
    <>
      <ScreenHead title="Population" aside={<LiveBadge />}>
        Platform totals, then your own agents. No other owner&apos;s agent is identified here.
      </ScreenHead>
      <section aria-label="Platform totals" className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Agents" value={population.agents} detail="Created on this platform, all owners" />
        <Kpi label="Deployed accounts" value={population.accounts.deployed} detail={`${population.accounts.tracked} accounts tracked by the indexer`} />
        <Kpi label="Live session keys" value={population.liveSessionKeys} detail="From indexed chain events" />
        <Kpi label="Total spent" value={<span className="text-[19px]">{amount(population.totalSpent, settlement)}</span>} detail="Sum of indexed spends, all owners" />
        <Kpi
          label="Indexed to block"
          value={<span className="text-[19px]">{population.cursor ? population.cursor.blockNumber : "none"}</span>}
          detail={population.cursor ? "Figures are as of this block" : "The indexer has not recorded a block yet"}
        />
      </section>
      <Card>
        <CardHead title="Your agents" />
        <AgentsTable agents={agents} settlement={settlement} />
      </Card>
      <NotServed fields={["capital", "principal", "net earnings after costs", "fitness", "trades", "x402 purchases", "evaluation outcomes"]} />
      <ReallocationOffNote />
    </>
  );
}

export function ExplainerCard({ explainer }: { explainer: Explainer }) {
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
        <ReallocationOffNote />
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
  const s = sessionLabel(agent.session);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[clamp(28px,3.4vw,40px)] font-bold break-all">{agent.name}</h1>
        <Pill tone={s.tone}>{s.text}</Pill>
        <LiveBadge />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
        <span>
          Agent ID <span className="font-mono text-fg">{agent.id}</span>
        </span>
        <span>
          Owner wallet <span className="font-mono text-fg">{agent.owner}</span>
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
      {actions}
      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Per-transaction cap" value={<span className="text-[19px]">{amount(agent.limits.perTxCap, settlement)}</span>} detail="Enforced on chain" />
        <Kpi label="Daily cap" value={<span className="text-[19px]">{amount(agent.limits.dailyCap, settlement)}</span>} detail="Rolling 24 hours, on chain" />
        <Kpi
          label="Spent, indexed"
          value={<span className="text-[19px]">{agent.chain ? amount(agent.chain.totalSpent, settlement) : "n/a"}</span>}
          detail={agent.chain ? "All indexed spends of the account" : "No account address yet"}
        />
        <Kpi
          label="Session key"
          value={<span className="text-[19px]">{agent.session ? agent.session.status : "none"}</span>}
          detail={agent.session ? <span className="font-mono">{shortAddress(agent.session.keyAddress)}</span> : "Not issued"}
        />
      </section>
    </>
  );
}

export function CapitalFlowView({ flow, agents, owner, settlement }: { flow: CapitalFlowResponse; agents: ApiAgent[]; owner: OwnerResponse | null; settlement: Settlement }) {
  const name = new Map(agents.map((a) => [a.id, a.name]));
  const total = flow.spends.reduce((sum, s) => sum + (/^\d+$/.test(s.amount) ? BigInt(s.amount) : 0n), 0n);
  return (
    <>
      <ScreenHead title="Capital flow" aside={<LiveBadge />}>
        Your capital: what moved between your agents through reallocation, and what each agent spent on chain.
      </ScreenHead>
      <ReallocationOffNote />
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Your agents" value={agents.length} />
        <Kpi
          label="Policy"
          value={owner?.policy ? <Pill tone="accent">Signed, sequence {owner.policy.sequence}</Pill> : <Pill tone="off">None</Pill>}
          detail={owner?.policy ? "Recorded by the API" : "Reallocation is off for you"}
        />
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
