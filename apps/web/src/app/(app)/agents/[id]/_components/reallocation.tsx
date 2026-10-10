import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Card, CardHead, Pill } from "@/components/ui";
import { boundsFor } from "@/data/evaluate";
import { explain, proximity, type Counterpart } from "@/data/explain";
import type { Agent, AgentEvaluation, Owner } from "@/data/types";
import { pct, usd } from "@/lib/format";

/** A bar from zero to `max`, with the agent's value marked. Decorative: the text beside it says the same. */
function Meter({ value, max, tone }: { value: number; max: number; tone: string }) {
  const w = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
      <span className="block h-full rounded-full" style={{ width: `${w}%`, background: tone }} />
    </div>
  );
}

function Limit({ title, status, detail, meter }: { title: string; status: string; detail: string; meter: React.ReactNode }) {
  return (
    <li className="grid gap-2 rounded-xl bg-surface-2 px-3.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <b>{title}</b>
        <span className="font-mono text-[13px] tabular">{status}</span>
      </div>
      {meter}
      <small className="text-xs text-muted">{detail}</small>
    </li>
  );
}

/**
 * The reallocation and retirement explainer (issue #43): what the mechanism did to this agent at the last evaluation
 * and why, what would change it, how close the agent is to each limit, and, under a policy, the plain statement of
 * what the owner consented to. It reads the same source as the rest of the agent view.
 */
export function ReallocationPanel({
  agent,
  evaluation,
  owner,
  counterparts,
}: {
  agent: Agent;
  evaluation: AgentEvaluation | null;
  owner: Owner | null;
  counterparts: Counterpart[];
}) {
  const x = evaluation ? explain(agent, evaluation, owner, counterparts) : null;
  const p = proximity(agent, owner);
  const b = boundsFor(owner);
  const retired = agent.status === "retired";
  const policy = owner?.policy ?? null;
  const covered = !!policy && policy.agentIds.includes(agent.id);
  const belowPrincipal = agent.capital < agent.principal;
  const toFloor = agent.capital - p.floor;
  const toCeiling = p.ceilingCapital - agent.capital;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHead title={evaluation ? `Evaluation ${evaluation.evaluation}` : "Last evaluation"}>{x && <Pill tone={x.tone}>{x.label}</Pill>}</CardHead>
        {x ? (
          <div className="grid gap-3.5">
            <p className="text-[17px] font-semibold">{x.headline}</p>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="eyebrow">Why</dt>
                <dd className="m-0 mt-1">{x.why}</dd>
              </div>
              <div>
                <dt className="eyebrow">What would change it</dt>
                <dd className="m-0 mt-1">{x.change}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="text-sm text-muted">No evaluation has run since this agent was created.</p>
        )}
        {owner && (
          <Link href={`/capital-flow?owner=${owner.id}`} className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-accent-hi hover:underline">
            Capital flow for {owner.name}
            <Icon name="arrow" className="size-3.5" />
          </Link>
        )}
      </Card>

      <Card>
        <CardHead title="How close it is to each limit" />
        {retired ? (
          <p className="text-sm text-muted">Retired. No limit applies any more, and its balance stays in its account.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2.5 p-0">
            <Limit
              title="Starvation rule"
              status={`${p.lowWindows} of ${p.starvationWindows} low windows`}
              meter={<Meter value={p.lowWindows} max={p.starvationWindows} tone={p.lowWindows >= p.starvationWindows - 1 ? "var(--bad)" : "var(--warn)"} />}
              detail={`It retires after ${p.starvationWindows} evaluations in a row in the bottom tenth of its niche. One evaluation outside it resets the count.`}
            />
            <Limit
              title="Capital floor"
              status={toFloor > 0 ? `${usd(toFloor)} above ${usd(p.floor)}` : `At ${usd(p.floor)}`}
              meter={<Meter value={Math.min(toFloor, p.principal)} max={p.principal} tone="var(--accent)" />}
              detail={`Below ${usd(p.floor)} it retires. Reallocation never takes it below the floor.`}
            />
            <Limit
              title="Slot ceiling"
              status={toCeiling > 0 ? `${usd(toCeiling)} of room` : "At or above its ceiling"}
              meter={<Meter value={agent.capital} max={p.ceilingCapital} tone="var(--good)" />}
              detail={`Reallocation never raises it above ${p.ceilingMultiple} times its principal, ${usd(p.ceilingCapital)}. Trading can.`}
            />
            {covered && (
              <Limit
                title="At the next evaluation"
                status={`Send up to ${usd(p.maxSend)} · receive up to ${usd(p.maxReceive)}`}
                meter={null}
                detail={`What it could send if it ranks lowest (at most ${pct(b.cap)} of its capital, never below the floor) or receive if it ranks highest${agent.zeroDownsideFlag ? "; nothing while it is flagged for zero downside" : ""}.`}
              />
            )}
          </ul>
        )}
      </Card>

      <Card className="lg:col-span-2">
        <CardHead title="What the owner agreed to">{policy ? <Pill tone="accent">Policy in force</Pill> : <Pill tone="off">No policy</Pill>}</CardHead>
        {policy ? (
          <div className="grid gap-3 text-sm">
            <div className="flex items-start gap-3 rounded-[14px] bg-warn-wash px-4 py-3.5">
              <span className="mt-0.5 text-warn">
                <Icon name="alert" />
              </span>
              <span>
                <b>Reallocation can take an agent below its own principal.</b> Under this policy, {covered ? "this agent" : "a covered agent"} can end up
                with less than the {usd(agent.principal)} its owner put in, while the owner&apos;s total across their agents stays the same: every move goes
                from one of the owner&apos;s agents to another, and nothing leaves the owner&apos;s accounts.
                {covered && belowPrincipal && ` It is below its principal now: ${usd(agent.capital)} of ${usd(agent.principal)}.`}
              </span>
            </div>
            <p className="text-muted">
              Signed by {owner?.name}&apos;s root wallet at evaluation {policy.signedAtEvaluation}. It covers {policy.agentIds.length} of the owner&apos;s
              agents{covered ? ", including this one" : ", not this one"}, moves at most {pct(b.cap)} of a source&apos;s capital per evaluation, and keeps
              every sink at or below {b.ceiling} times its principal. A policy can tighten these bounds, never loosen them. The owner can revoke it at any
              time; from the next evaluation nothing moves.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Reallocation is off by default and is off for this owner. If the owner signs a policy, capital can move between the agents it names, and
            reallocation can then take an agent below its own principal while keeping the owner&apos;s total unchanged.
          </p>
        )}
      </Card>
    </div>
  );
}
