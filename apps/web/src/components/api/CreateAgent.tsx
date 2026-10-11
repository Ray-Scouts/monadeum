"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Card, CardHead, Pill, ScreenHead } from "@/components/ui";
import { createErrorText, createInput, FUNDING_NOTE, PRESET_CAVEAT, strategySummary } from "@/data/api/create";
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

/** The creation form: preset, name, caps, and the funding note. Presentational, so tests render it directly. */
export function CreateFormView({ presets, form, settlement, busy, error, onChange, onSubmit }: CreateFormViewProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Card>
        <CardHead title="Strategy" />
        <p className="mb-3 text-[13px] text-muted">The server builds the agent&apos;s genome from the preset you pick; it is fixed for the agent&apos;s life. {PRESET_CAVEAT}</p>
        <fieldset className="grid gap-2.5">
          <legend className="sr-only">Preset</legend>
          {presets.presets.map((p) => (
            <label key={p.name} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line-soft p-3.5 has-[:checked]:border-accent has-[:checked]:bg-accent-wash">
              <input type="radio" name="preset" value={p.name} checked={form.preset === p.name} onChange={() => onChange({ ...form, preset: p.name })} className="mt-1" />
              <span className="grid gap-1 text-sm">
                <span className="font-semibold capitalize">
                  {p.name} {p.name === presets.default && <Pill tone="accent">Default</Pill>}
                </span>
                <ul className="m-0 list-disc pl-5 text-muted">
                  {strategySummary(p, presets.pair).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <span className="font-mono text-xs text-faint" title="The hash of the genome this preset commits, for the configured pair">
                  Genome hash {p.genomeHash}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </Card>

      <Card>
        <CardHead title="Name and limits" />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">
            Name
            <input className="rounded-lg border border-line bg-surface-2 px-3 py-2" value={form.name} maxLength={64} onChange={(e) => onChange({ ...form, name: e.target.value })} />
          </label>
          <label className="grid gap-1 text-sm">
            Per-transaction cap ({unit(settlement)})
            <input className="rounded-lg border border-line bg-surface-2 px-3 py-2" inputMode="decimal" value={form.perTxCap} onChange={(e) => onChange({ ...form, perTxCap: e.target.value })} />
          </label>
          <label className="grid gap-1 text-sm">
            Daily cap ({unit(settlement)})
            <input className="rounded-lg border border-line bg-surface-2 px-3 py-2" inputMode="decimal" value={form.dailyCap} onChange={(e) => onChange({ ...form, dailyCap: e.target.value })} />
          </label>
        </div>
        <p className="mt-2 text-[13px] text-muted">Both caps are enforced on chain by the agent&apos;s account. The API refuses caps above the highest this server allows.</p>
      </Card>

      <p role="note" className="rounded-xl border border-warn bg-warn-wash px-4 py-3 text-sm text-warn">
        {FUNDING_NOTE}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create agent"}
        </button>
        <span className="text-[13px] text-muted">Your owner wallet then signs the deployment of the agent&apos;s account.</span>
      </div>
      <p role="alert" className="text-sm text-bad empty:hidden">
        {error}
      </p>
    </form>
  );
}

export function ApiCreateAgent() {
  const session = useSession();
  const settlement = WEB_CONFIG.settlement;
  const { data: presets, error: loadError } = useApiData((s) => s.presets(), "presets");
  const [form, setForm] = useState<CreateForm>({ name: "", perTxCap: "", dailyCap: "", preset: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ agent: ApiAgent; operation: Operation } | null>(null);

  const head = (
    <ScreenHead title="Create your agent" aside={<LiveBadge />}>
      Pick a preset, name the agent, and set the limits its account enforces on chain.
    </ScreenHead>
  );
  if (!presets) return <>{head}{loadError ? <ErrorNote error={loadError} /> : <p role="status" className="text-muted">Loading presets…</p>}</>;
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
          <p className="text-sm text-muted">Its record exists. Its account is deployed once your owner wallet signs the deployment below.</p>
          {!done && (
            <div className="mt-3">
              <OperationSigner operation={operation} name={() => agent.name} onChange={(op) => setCreated({ agent, operation: op })} />
            </div>
          )}
          {done && (
            <p role="status" className="mt-3 text-sm">
              {operation.status === "succeeded"
                ? "Deployment finished."
                : `Deployment did not finish (${operation.error ?? "unknown"}). You can retry it from the agent's page.`}
            </p>
          )}
          <p role="note" className="mt-3 rounded-xl border border-warn bg-warn-wash px-4 py-3 text-sm text-warn">
            {FUNDING_NOTE}
          </p>
          <Link href={`/agents/${encodeURIComponent(agent.id)}`} className="btn mt-3">
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
