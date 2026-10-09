"use client";

import { useId, useState } from "react";
import { Card, CardHead } from "@/components/ui";
import { Icon } from "@/components/Icon";

type Mode = "simulation" | "testnet" | "mainnet";

const MODES: { value: Mode; label: string; detail: string }[] = [
  { value: "simulation", label: "Simulation", detail: "No real money. Deterministic markets." },
  { value: "testnet", label: "Testnet", detail: "Test assets. Validates the whole flow." },
  { value: "mainnet", label: "Mainnet", detail: "Enabled by you. Strict limits active." },
];

function Switch({ id, checked, onChange, title, code }: { id: string; checked: boolean; onChange: (v: boolean) => void; title: string; code: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-3 text-sm">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <b className="font-semibold">{title}</b>
        <br />
        <code className="font-mono text-[13px] break-all text-muted">{code}</code>
      </label>
      <span className="relative h-[26px] w-11 flex-none">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          aria-checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 m-0 cursor-pointer opacity-0"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full bg-line transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-hi after:absolute after:top-[3px] after:left-[3px] after:size-5 after:rounded-full after:bg-white after:transition-transform after:content-[''] peer-checked:after:translate-x-[18px]"
        />
      </span>
    </div>
  );
}

/** Operating mode picker. Mainnet stays locked until both the account switch and the agent switch are on. */
export function OperatingMode({ agentLabel }: { agentLabel: string }) {
  const [mode, setMode] = useState<Mode>("testnet");
  const [userFlag, setUserFlag] = useState(false);
  const [agentFlag, setAgentFlag] = useState(false);
  const unlocked = userFlag && agentFlag;
  const name = useId();
  const lockId = useId();

  const setFlag = (set: (v: boolean) => void) => (v: boolean) => {
    set(v);
    // turning a switch off while on mainnet drops back to testnet
    if (!v && mode === "mainnet") setMode("testnet");
  };

  return (
    <Card>
      <CardHead title="Operating mode">
        <span className="text-[13px] text-muted">Mainnet needs both switches on</span>
      </CardHead>
      <div role="radiogroup" aria-label="Operating mode" className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {MODES.map((m) => {
          const locked = m.value === "mainnet" && !unlocked;
          return (
            <label
              key={m.value}
              className={`flex flex-col gap-2 rounded-[14px] border-[1.5px] border-line-soft bg-surface-2 p-[18px] has-checked:border-accent has-checked:bg-accent-wash has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent-hi ${locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              <input
                type="radio"
                name={name}
                value={m.value}
                checked={mode === m.value}
                disabled={locked}
                aria-describedby={locked ? lockId : undefined}
                onChange={() => setMode(m.value)}
                className="sr-only"
              />
              <span className="flex items-center gap-2 font-display text-lg font-bold">
                {locked && <Icon name="lock" className="size-4" />}
                {m.label}
              </span>
              <span className="text-[13px] text-muted">
                {locked ? <span id={lockId}>Locked until both switches are on.</span> : m.detail}
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-3.5 grid gap-2.5">
        <Switch id="flag-user" checked={userFlag} onChange={setFlag(setUserFlag)} title="Mainnet for my account" code="user.mainnetEnabled" />
        <Switch id="flag-agent" checked={agentFlag} onChange={setFlag(setAgentFlag)} title={`Mainnet for ${agentLabel}`} code="agent.mainnetEnabled" />
      </div>
      <p role="status" aria-live="polite" className="mt-3 text-[13px] text-muted">
        Current mode: <b className="text-fg">{MODES.find((m) => m.value === mode)!.label}</b>. This is a sample: switching changes nothing outside this page.
      </p>
    </Card>
  );
}
