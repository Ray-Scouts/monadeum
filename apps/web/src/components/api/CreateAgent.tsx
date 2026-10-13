"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { Card, CardHead, Pill, ScreenHead } from "@/components/ui";
import { agentSummary, createErrorText, createInput, FUNDING_NOTE, isRecommended, NAME_RULE, PRESET_CAVEAT, RECOMMENDED, strategySummary } from "@/data/api/create";
import type { ApiAgent, Operation, PresetsResponse } from "@/data/api/types";
import { WEB_CONFIG, type WebConfig } from "@/data/config";
import { useSession } from "./auth";
import { ErrorNote } from "./ErrorNote";
import { OperationSigner } from "./OperationSigner";
import { useApiData } from "./useApiData";
import { LiveBadge } from "./views";

export interface CreateForm {
  name: string;
  perTxCap: string;
  dailyCap: string;
  preset: string;
}

export interface CreateFormViewProps {
  presets: PresetsResponse;
  form: CreateForm;
  settlement: WebConfig["settlement"];
  busy: boolean;
  error: string | null;
  onChange(form: CreateForm): void;
  onSubmit(): void;
}

const unit = (s: WebConfig["settlement"]) => s.symbol ?? "settlement asset units";

const FIELD = "rounded-lg border border-line bg-surface-2 px-3 py-2";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="eyebrow">{title}</span>
      {children}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="long-value m-0 mt-1 grid list-disc gap-1 pl-5 text-[13px] text-muted">
      {items.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

/**
 * The creation form. The recommended starter agent is selected and summarized in plain language, and one button creates
 * it without opening anything. Every setting that can be changed sits under "Advanced settings", each with what it
 * means and its bounds. Presentational, so tests render it directly.
 */
export function CreateFormView({ presets, form, settlement, busy, error, onChange, onSubmit }: CreateFormViewProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  const u = unit(settlement);
  const selected = presets.presets.find((p) => p.name === form.preset) ?? presets.presets.find((p) => p.name === presets.default) ?? presets.presets[0];
  const recommended = isRecommended(form, presets.default);
  const summary = selected ? agentSummary(u, form, selected, presets.pair) : null;
  const decimals = settlement.decimals;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Card>
        <CardHead title={recommended ? "Recommended starter agent" : "Your agent"}>
          {recommended && <Pill tone="accent">Recommended</Pill>}
        </CardHead>
        <p className="text-[13px] text-muted">
          {recommended
            ? "These are the settings we suggest for a first agent. You do not need to change anything: give it a name if you like and create it."
            : "You changed the settings below. Review this summary, or restore the recommended settings under Advanced settings."}
        </p>
        <label className="mt-3 grid max-w-md gap-1 text-sm">
          Name
          <input className={FIELD} value={form.name} maxLength={64} autoComplete="off" aria-describedby="name-help" onChange={(e) => onChange({ ...form, name: e.target.value })} />
          <span id="name-help" className="text-xs text-muted">
            Only for you, to tell your agents apart. {NAME_RULE}
          </span>
        </label>
        {summary && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Section title="What it will do">
              <Bullets items={summary.does} />
            </Section>
            <Section title="What it can never do">
              <Bullets items={summary.never} />
            </Section>
            <Section title="What it costs">
              <p className="mt-1 text-[13px] text-muted">{summary.costs}</p>
            </Section>
            <Section title="What happens next">
              <Bullets items={summary.next} />
            </Section>
          </div>
        )}
        <p className="mt-4 text-xs text-muted">{PRESET_CAVEAT}</p>
        {selected && (
          <p className="long-value mt-1 font-mono text-xs text-faint" title="The hash of the genome this preset commits, for the configured pair">
            Preset {selected.name}, genome hash {selected.genomeHash}
          </p>
        )}
      </Card>

      <p role="note" className="rounded-xl border border-warn bg-warn-wash px-4 py-3 text-sm text-warn">
        {FUNDING_NOTE}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary btn-lg w-full sm:w-auto" disabled={busy}>
          {busy ? "Creating…" : recommended ? "Create with recommended settings" : "Create agent with these settings"}
        </button>
        <span className="min-w-0 text-[13px] text-muted">Your owner wallet then signs the deployment of the agent&apos;s account.</span>
      </div>
      <p role="alert" className="long-value text-sm text-bad empty:hidden">
        {error}
      </p>

      <details className="rounded-2xl border border-line-soft bg-surface">
        <summary className="tap-y flex cursor-pointer flex-wrap items-center gap-2 px-5 text-sm font-semibold">
          Advanced settings
          {!recommended && <Pill tone="warn">Changed</Pill>}
        </summary>
        <div className="flex flex-col gap-5 px-5 pb-5">
          <fieldset className="grid gap-2.5">
            <legend className="mb-1 text-sm font-semibold">Strategy preset</legend>
            <p className="m-0 text-[13px] text-muted">
              The server builds the agent&apos;s genome from the preset you pick; it is fixed for the agent&apos;s life. The recommended one is {presets.default}.
            </p>
            {presets.presets.map((p) => (
              <label key={p.name} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line-soft p-3.5 has-[:checked]:border-accent has-[:checked]:bg-accent-wash">
                <input type="radio" name="preset" value={p.name} checked={form.preset === p.name} onChange={() => onChange({ ...form, preset: p.name })} className="mt-1" />
                <span className="grid min-w-0 gap-1 text-sm">
                  <span className="font-semibold capitalize">
                    {p.name} {p.name === presets.default && <Pill tone="accent">Recommended</Pill>}
                  </span>
                  <ul className="m-0 list-disc pl-5 text-muted">
                    {strategySummary(p, presets.pair).map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                  <span className="long-value font-mono text-xs text-faint" title="The hash of the genome this preset commits, for the configured pair">
                    Genome hash {p.genomeHash}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid content-start gap-1 text-sm">
              Per-transaction cap ({u})
              <input className={FIELD} inputMode="decimal" autoComplete="off" aria-describedby="per-tx-help" value={form.perTxCap} onChange={(e) => onChange({ ...form, perTxCap: e.target.value })} />
              <span id="per-tx-help" className="text-xs text-muted">
                The most the agent&apos;s account lets it spend in one transaction. More than 0, at most {decimals} decimal places, and not above the daily cap. Recommended: {RECOMMENDED.perTxCap}.
              </span>
            </label>
            <label className="grid content-start gap-1 text-sm">
              Daily cap ({u})
              <input className={FIELD} inputMode="decimal" autoComplete="off" aria-describedby="daily-help" value={form.dailyCap} onChange={(e) => onChange({ ...form, dailyCap: e.target.value })} />
              <span id="daily-help" className="text-xs text-muted">
                The most it can spend in any rolling 24 hours, enforced on chain. More than 0, at most {decimals} decimal places. The server refuses caps above the highest it allows. Recommended: {RECOMMENDED.dailyCap}.
              </span>
            </label>
          </div>

          <button
            type="button"
            className="btn self-start"
            disabled={recommended}
            onClick={() => onChange({ ...form, preset: presets.default, perTxCap: RECOMMENDED.perTxCap, dailyCap: RECOMMENDED.dailyCap })}
          >
            Restore recommended settings
          </button>
        </div>
      </details>
    </form>
  );
}

export function ApiCreateAgent() {
  const session = useSession();
  const settlement = WEB_CONFIG.settlement;
  const { data: presets, error: loadError } = useApiData((s) => s.presets(), "presets");
  // The recommended starting values are selected, so one click creates an agent; the API still refuses anything above its configured maximum.
  const [form, setForm] = useState<CreateForm>({ name: RECOMMENDED.name, perTxCap: RECOMMENDED.perTxCap, dailyCap: RECOMMENDED.dailyCap, preset: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ agent: ApiAgent; operation: Operation } | null>(null);

  const head = (
    <ScreenHead title="Create your agent" aside={<LiveBadge />}>
      Start with the recommended settings, or open Advanced settings to choose the strategy and the limits yourself.
    </ScreenHead>
  );
  if (!presets) return <>{head}{loadError ? <ErrorNote error={loadError} /> : <p role="status" className="text-muted">Loading the recommended settings…</p>}</>;
  const current = { ...form, preset: form.preset || presets.default };

  async function submit() {
    if (!session) return;
    const checked = createInput(current, settlement);
    if (!checked.ok) return setError(checked.error);
    setBusy(true);
    setError(null);
    try {
      setCreated(await session.createAgent(checked.input));
    } catch (e) {
      setError(createErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    const { agent, operation } = created;
    const done = operation.status === "succeeded" || operation.status === "failed";
    return (
      <>
        {head}
        <Card>
          <CardHead title={`${agent.name} was created`} />
          <p className="long-value text-sm text-muted">Its record exists. Its account is deployed once your owner wallet signs the deployment below.</p>
          {!done && (
            <div className="mt-3">
              <OperationSigner operation={operation} name={() => agent.name} onChange={(op) => setCreated({ agent, operation: op })} />
            </div>
          )}
          {done && (
            <p role="status" className="mt-3 text-sm">
              {operation.status === "succeeded"
                ? "Deployment finished. Open the agent to fund it, then activate it."
                : "Deployment did not finish, so the account is not deployed yet. Open the agent and choose Deploy the account to try again."}
            </p>
          )}
          <p role="note" className="mt-3 rounded-xl border border-warn bg-warn-wash px-4 py-3 text-sm text-warn">
            {FUNDING_NOTE}
          </p>
          <Link href={`/agents/${encodeURIComponent(agent.id)}`} className="btn btn-primary mt-3 w-full sm:w-auto">
            Open {agent.name}
          </Link>
        </Card>
      </>
    );
  }

  return (
    <>
      {head}
      <CreateFormView presets={presets} form={current} settlement={settlement} busy={busy} error={error} onChange={setForm} onSubmit={() => void submit()} />
    </>
  );
}
