"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { riskBand } from "@monadeum/fitness/math";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { Card, Identicon, SampleBadge } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { FUNDING_RULE } from "@/data/funding";
import { usd } from "@/lib/format";
import { AMOUNT_PRESETS, parseAmount, PRESETS, type Draft, type Model } from "./draft";
import { identicon, NICHE_COUNT, Preview } from "./Preview";

const STEPS = ["Sign in", "Strategy", "Genome", "Fund"] as const;
const SAMPLE_WALLET = "0x4f2a…91c3";
const DEFAULT_PRESET = 1;

type FieldClass = "capped" | "allowlist" | "closed list";
const CLASS_STYLE: Record<FieldClass, string> = {
  capped: "bg-berry-wash text-berry",
  allowlist: "bg-accent-wash text-accent-hi",
  "closed list": "bg-berry-wash text-berry",
};

function ClassChip({ kind }: { kind: FieldClass }) {
  return <span className={`ml-2 rounded px-1.5 py-0.5 align-[2px] font-mono text-[10px] tracking-[0.06em] uppercase ${CLASS_STYLE[kind]}`}>{kind}</span>;
}

function Field({ children }: { children: ReactNode }) {
  return <div className="grid gap-2 border-b border-line-soft py-4 last:border-b-0">{children}</div>;
}

function FieldHead({ htmlFor, label, kind, output }: { htmlFor?: string; label: string; kind: FieldClass; output?: ReactNode }) {
  const Tag = htmlFor ? "label" : "span";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Tag htmlFor={htmlFor} className="font-semibold">
        {label}
        <ClassChip kind={kind} />
      </Tag>
      {output !== undefined && (
        <output htmlFor={htmlFor} className="font-mono text-[15px] font-semibold text-accent-hi tabular">
          {output}
        </output>
      )}
    </div>
  );
}

function Scale({ lo, hi }: { lo: string; hi: string }) {
  return (
    <div className="flex justify-between font-mono text-[11px] text-faint">
      <span>{lo}</span>
      <span>{hi}</span>
    </div>
  );
}

const range = "w-full accent-accent";

export function CreateFlow({ pairs }: { pairs: readonly string[] }) {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [signedWith, setSignedWith] = useState<string | null>(null);
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [draft, setDraft] = useState<Draft>(() => PRESETS[DEFAULT_PRESET]!.draft(pairs));
  const [amountText, setAmountText] = useState(String(PROTOCOL.principal));
  const [touched, setTouched] = useState(false);
  const [pairNote, setPairNote] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const ids = { risk: useId(), freq: useId(), budget: useId(), model: useId(), amount: useId(), amountErr: useId(), pairs: useId(), presets: useId() };

  const parsed = parseAmount(amountText);
  const amountOk = "amount" in parsed;
  const amount = amountOk ? parsed.amount : PROTOCOL.principal;
  const signed = signedWith !== null;

  // move focus to the new step's heading, but not on first render
  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [step, done]);

  const go = (i: number) => {
    setStep(i);
    setDone(false);
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const togglePair = (p: string, on: boolean) => {
    if (!on && draft.assetUniverse.length === 1) {
      setPairNote("At least one pair is required.");
      return;
    }
    setPairNote("");
    set("assetUniverse", on ? pairs.filter((x) => x === p || draft.assetUniverse.includes(x)) : draft.assetUniverse.filter((x) => x !== p));
  };

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 0 && !signed) return;
    if (step < STEPS.length - 1) go(step + 1);
    else if (amountOk) setDone(true);
    else setTouched(true);
  };

  const canEnter = (i: number) => i === 0 || signed;

  const headingEl = (eyebrow: string, title: string, body: ReactNode) => (
    <>
      <span className="eyebrow">{eyebrow}</span>
      <h2 ref={heading} tabIndex={-1} className="mt-2 text-[26px] font-bold focus:outline-none focus-visible:outline-2">
        {title}
      </h2>
      <p className="mt-2 max-w-[58ch] text-muted">{body}</p>
    </>
  );

  const authButton = (icon: IconName, label: string, ghost = false) => (
    <button
      type="button"
      aria-pressed={signedWith === label}
      onClick={() => setSignedWith(label)}
      className={`btn w-full justify-start rounded-[14px] px-[18px] py-3.5 aria-pressed:border-accent ${ghost ? "btn-ghost" : ""}`}
    >
      <Icon name={icon} />
      {label}
    </button>
  );

  let panel: ReactNode;
  if (done) {
    panel = (
      <div className="flex flex-col items-center gap-3.5 px-5 py-10 text-center">
        <Identicon agent={identicon(draft)} className="size-[84px] rounded-3xl" />
        <h2 ref={heading} tabIndex={-1} className="text-[26px] font-bold focus:outline-none focus-visible:outline-2">
          Your agent is alive
        </h2>
        <p className="max-w-[44ch] text-muted">
          Its smart account would be created on testnet with sponsored gas, holding {usd(amount)} as principal. It will run a tick every {draft.executionFrequency} intervals.
        </p>
        <SampleBadge>Simulated: nothing was created or funded</SampleBadge>
        <div className="flex flex-wrap justify-center gap-2.5">
          <Link href="/population" className="btn btn-primary">
            View my population
          </Link>
          <button type="button" className="btn" onClick={() => go(0)}>
            Create another
          </button>
        </div>
      </div>
    );
  } else {
    const isLast = step === STEPS.length - 1;
    panel = (
      <form onSubmit={next} noValidate>
        {step === 0 && (
          <>
            {headingEl("Step 1 of 4", "Sign in within seconds", "We create a wallet for you automatically. It owns all your agents and is the only one that can withdraw their funds.")}
            <div className="mt-6 grid max-w-[420px] gap-2.5">
              {authButton("google", "Continue with Google")}
              {authButton("mail", "Continue with email")}
              {authButton("key", "Use a passkey")}
              <div className="my-1.5 flex items-center gap-3 text-xs text-faint before:h-px before:flex-1 before:bg-line-soft after:h-px after:flex-1 after:bg-line-soft">advanced</div>
              {authButton("wallet", "Connect an external wallet", true)}
            </div>
            <div role="status" aria-live="polite">
              {signed && (
                <div className="mt-5 flex items-start gap-3 rounded-[14px] bg-good-wash px-4 py-3.5 text-sm">
                  <Icon name="check" className="mt-0.5 size-4 flex-none text-good" />
                  <span>
                    Signed in ({signedWith}, simulated). Wallet <span className="font-mono">{SAMPLE_WALLET}</span> ready.
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            {headingEl("Step 2 of 4", "Pick a starting point", "This is only a starting point. You can tune it in the next step. Once the agent is created its genome is fixed: for a different strategy, you create another agent.")}
            <div role="radiogroup" aria-label="Starting strategy" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {PRESETS.map((p, i) => {
                const d = p.draft(pairs);
                return (
                  <label
                    key={p.name}
                    className="relative flex cursor-pointer flex-col gap-2.5 rounded-[14px] border-[1.5px] border-line-soft bg-surface-2 p-[18px] has-checked:border-accent has-checked:bg-accent-wash has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent-hi"
                  >
                    <input
                      type="radio"
                      name={ids.presets}
                      checked={preset === i}
                      onChange={() => {
                        setPreset(i);
                        setDraft(d);
                        setPairNote("");
                      }}
                      className="peer sr-only"
                    />
                    <span aria-hidden="true" className="absolute top-3.5 right-3.5 hidden size-[18px] place-items-center rounded-full bg-accent text-white peer-checked:grid">
                      <Icon name="check" className="size-3" />
                    </span>
                    <b className="font-display text-lg font-bold">{p.name}</b>
                    <span className="text-[13px] text-muted">{p.description}</span>
                    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-xs">
                      <dt className="text-faint">Risk</dt>
                      <dd className="m-0 font-mono">{d.riskTolerance}</dd>
                      <dt className="text-faint">Tick</dt>
                      <dd className="m-0 font-mono">every {d.executionFrequency}</dd>
                      <dt className="text-faint">Pairs</dt>
                      <dd className="m-0 font-mono">{d.assetUniverse.length}</dd>
                    </dl>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            {headingEl("Step 3 of 4", "Tune its genome", "Protocol limits cannot be exceeded. The genome is fixed once the agent is created.")}
            <div className="mt-4">
              <Field>
                <FieldHead htmlFor={ids.risk} label="Risk tolerance" kind="capped" output={draft.riskTolerance.toFixed(2)} />
                <input
                  id={ids.risk}
                  type="range"
                  min={PROTOCOL.riskFloor}
                  max={PROTOCOL.riskCeiling}
                  step={0.01}
                  value={draft.riskTolerance}
                  onChange={(e) => set("riskTolerance", Number(e.target.value))}
                  aria-describedby={`${ids.risk}-hint`}
                  className={range}
                />
                <Scale lo={String(PROTOCOL.riskFloor)} hi={`protocol cap ${PROTOCOL.riskCeiling}`} />
                <small id={`${ids.risk}-hint`} className="text-xs text-muted">
                  Max fraction of capital in one position. Risk niche <b>{riskBand(draft.riskTolerance) + 1}</b> of {NICHE_COUNT}.
                </small>
              </Field>
              <Field>
                <FieldHead htmlFor={ids.freq} label="Interval between ticks" kind="capped" output={draft.executionFrequency} />
                <input
                  id={ids.freq}
                  type="range"
                  min={PROTOCOL.frequencyMin}
                  max={PROTOCOL.frequencyMax}
                  step={1}
                  value={draft.executionFrequency}
                  onChange={(e) => set("executionFrequency", Number(e.target.value))}
                  aria-describedby={`${ids.freq}-hint`}
                  className={range}
                />
                <Scale lo={`${PROTOCOL.frequencyMin} (minimum)`} hi={String(PROTOCOL.frequencyMax)} />
                <small id={`${ids.freq}-hint`} className="text-xs text-muted">
                  Lower frequency means less gas and less x402 spend.
                </small>
              </Field>
              <Field>
                <fieldset aria-describedby={`${ids.pairs}-hint`} className="grid gap-2">
                  <legend className="mb-2 font-semibold">
                    Asset universe
                    <ClassChip kind="allowlist" />
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {pairs.map((p) => {
                      const id = `${ids.pairs}-${p}`;
                      return (
                        <label
                          key={p}
                          htmlFor={id}
                          className="inline-flex cursor-pointer items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-3 py-2 font-mono text-[13px] has-checked:border-accent has-checked:bg-accent-wash has-focus-visible:outline-2 has-focus-visible:outline-accent-hi"
                        >
                          <input id={id} type="checkbox" checked={draft.assetUniverse.includes(p)} onChange={(e) => togglePair(p, e.target.checked)} className="accent-accent" />
                          {p}
                        </label>
                      );
                    })}
                  </div>
                  <small id={`${ids.pairs}-hint`} className="text-xs text-muted">
                    Sample pairs; the real allowlist is not decided yet. At least one is required.
                  </small>
                  <p role="status" aria-live="polite" className="text-xs text-warn empty:hidden">
                    {pairNote}
                  </p>
                </fieldset>
              </Field>
              <Field>
                <FieldHead htmlFor={ids.budget} label="Information budget per tick" kind="capped" output={usd(draft.informationBudget)} />
                <input
                  id={ids.budget}
                  type="range"
                  min={0}
                  max={PROTOCOL.informationBudgetCeiling}
                  step={0.01}
                  value={draft.informationBudget}
                  onChange={(e) => set("informationBudget", Number(e.target.value))}
                  aria-describedby={`${ids.budget}-hint`}
                  className={range}
                />
                <Scale lo="0" hi={`protocol cap ${PROTOCOL.informationBudgetCeiling}`} />
                <small id={`${ids.budget}-hint`} className="text-xs text-muted">
                  Max spend on Nansen and DeFiLlama via x402.
                </small>
              </Field>
              <Field>
                <FieldHead htmlFor={ids.model} label="Model configuration" kind="closed list" />
                <select
                  id={ids.model}
                  value={draft.modelConfiguration}
                  onChange={(e) => set("modelConfiguration", e.target.value as Model)}
                  className="rounded-[10px] border border-line bg-surface-2 px-3 py-2 font-mono text-sm"
                >
                  {PROTOCOL.allowedModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            {headingEl("Step 4 of 4", "Give it starting capital", "This becomes its principal. If you later sign a reallocation policy that covers it, capital can move between it and your other agents, and it can end up below this amount while your total stays the same.")}
            <div role="group" aria-label="Amount" className="mt-5 flex flex-wrap gap-2.5">
              {AMOUNT_PRESETS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={amountOk && parsed.amount === v}
                  onClick={() => {
                    setAmountText(String(v));
                    setTouched(false);
                  }}
                  className="rounded-[14px] border-[1.5px] border-line-soft bg-surface-2 px-5 py-3.5 font-display text-xl font-bold aria-pressed:border-accent aria-pressed:bg-accent-wash"
                >
                  ${v}
                </button>
              ))}
              <div className="flex items-center gap-2 rounded-[14px] border-[1.5px] border-line bg-surface-2 px-3.5 py-2.5 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-accent-hi has-[input[aria-invalid=true]]:border-bad">
                <label htmlFor={ids.amount} className="text-muted">
                  <span className="sr-only">Custom amount in dollars</span>
                  <span aria-hidden="true">$</span>
                </label>
                <input
                  id={ids.amount}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amountText}
                  onChange={(e) => {
                    setAmountText(e.target.value);
                    setTouched(true);
                  }}
                  aria-invalid={touched && !amountOk}
                  aria-describedby={ids.amountErr}
                  className="w-[90px] border-0 bg-transparent font-display text-xl font-bold outline-none"
                />
              </div>
            </div>
            <p id={ids.amountErr} role="status" aria-live="polite" className="mt-2 min-h-5 text-[13px] text-bad">
              {touched && !amountOk ? parsed.error : ""}
            </p>
            <div className="mt-4 flex items-start gap-3 rounded-[14px] bg-good-wash px-4 py-3.5 text-sm">
              <Icon name="shield" className="mt-0.5 size-4 flex-none text-good" />
              <span>
                <b>No MON needed.</b> The platform sponsors gas to create the agent account and its first trades, up to a budget.
              </span>
            </div>
            <p role="note" className="mt-3 rounded-[14px] border border-warn bg-warn-wash px-4 py-3.5 text-sm text-warn">
              <b>What counts as funding.</b> {FUNDING_RULE}
            </p>
          </>
        )}

        <div className="mt-7 flex flex-wrap justify-between gap-3">
          {step > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={() => go(step - 1)}>
              <Icon name="back" />
              Back
            </button>
          ) : (
            <span />
          )}
          <button type="submit" className="btn btn-primary" disabled={(step === 0 && !signed) || (isLast && !amountOk)}>
            {isLast ? "Create and start agent" : "Continue"}
            <Icon name="arrow" />
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      <nav aria-label="Steps">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((s, i) => {
            const complete = done || i < step;
            return (
              <li key={s}>
                <button
                  type="button"
                  aria-current={!done && i === step ? "step" : undefined}
                  disabled={!canEnter(i)}
                  onClick={() => go(i)}
                  className="group flex items-center gap-2.5 rounded-full border border-line-soft bg-surface py-2 pr-3.5 pl-2 text-sm text-muted aria-[current=step]:border-accent aria-[current=step]:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    className={`grid size-[26px] place-items-center rounded-full font-mono text-xs font-medium group-aria-[current=step]:bg-accent group-aria-[current=step]:text-white ${complete ? "bg-good-wash text-good" : "bg-surface-2"}`}
                  >
                    {complete ? <Icon name="check" className="size-3.5" /> : i + 1}
                    {complete && <span className="sr-only">(done)</span>}
                  </span>
                  {s}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="p-5 sm:p-7">{panel}</Card>
        <Preview draft={draft} amount={amount} />
      </div>
    </>
  );
}
