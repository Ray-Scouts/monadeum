import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Card, CardHead, Pill } from "@/components/ui";
import { nextStep, type FirstRunStep, type StepState } from "@/data/api/firstrun";

const TONE: Record<StepState, "good" | "accent" | "off" | "warn"> = { done: "good", current: "accent", blocked: "off", waiting: "warn" };
const LABEL: Record<StepState, string> = { done: "Done", current: "Next", blocked: "Blocked", waiting: "Waiting" };

/**
 * The first-run checklist on the agent page: create, fund, activate, watch. Each row shows the state the API reported
 * and, when there is something to do, the one action that does it. Presentational, so tests render it directly.
 */
export function FirstRunChecklist({ steps }: { steps: FirstRunStep[] }) {
  const next = nextStep(steps);
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <Card>
      <CardHead title={next ? "Getting started" : "Setup complete"}>
        <Pill tone={next ? "accent" : "good"}>
          {done} of {steps.length} done
        </Pill>
      </CardHead>
      <ol className="m-0 grid list-none gap-2.5 p-0">
        {steps.map((s, i) => (
          <li
            key={s.id}
            aria-current={next?.id === s.id ? "step" : undefined}
            className={`grid min-w-0 grid-cols-[28px_minmax(0,1fr)] gap-3 rounded-xl border p-3.5 ${next?.id === s.id ? "border-accent bg-accent-wash" : "border-line-soft"}`}
          >
            <span className={`mt-0.5 grid size-7 place-items-center rounded-full border text-xs font-semibold ${s.state === "done" ? "border-transparent bg-good-wash text-good" : "border-line text-muted"}`}>
              {s.state === "done" ? <Icon name="check" className="size-4" /> : i + 1}
            </span>
            <div className="grid min-w-0 gap-1.5 text-sm">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="font-semibold">{s.title}</span>
                <Pill tone={TONE[s.state]}>{s.state === "current" && next?.id !== s.id ? "Available" : LABEL[s.state]}</Pill>
              </div>
              <p className="long-value m-0 text-[13px] text-muted">{s.detail}</p>
              {s.action && (
                <Link href={s.action.href} className="btn btn-primary w-full justify-self-start sm:w-auto">
                  {s.action.label}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** On the dashboard: the one next step for the owner's newest unfinished agent, linking to where it is done. */
export function NextStepCard({ agentName, agentId, step }: { agentName: string; agentId: string; step: FirstRunStep }) {
  return (
    <Card>
      <CardHead title="Your next step" />
      <p className="long-value m-0 text-sm">
        <b>{agentName}</b>: {step.title.toLowerCase()}.
      </p>
      <p className="long-value mt-1 text-[13px] text-muted">{step.detail}</p>
      <Link href={step.action?.href ?? `/agents/${encodeURIComponent(agentId)}`} className="btn btn-primary mt-3 w-full sm:w-auto">
        {step.action?.label ?? "Open the agent"}
      </Link>
    </Card>
  );
}
