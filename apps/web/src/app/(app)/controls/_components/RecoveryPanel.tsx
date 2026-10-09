"use client";

import { useRef, useState } from "react";
import {
  confirmHold,
  decideRecovery,
  RECOVERY_DELAY_MS,
  RECOVERY_DISTINCT_LIMIT,
  RECOVERY_WINDOW_MS,
  type PriorRecovery,
  type RecoveryHold,
  type RecoveryKind,
} from "@monadeum/recovery/decide";
import { Card, CardHead, Identicon, SampleBadge } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { Agent } from "@/data/types";
import { agentLabel, usd } from "@/lib/format";

export type PickableAgent = Pick<Agent, "id" | "name" | "capital" | "genome" | "generation" | "status">;

const ROOT_WALLET = "sample-root-wallet";
const minutes = (ms: number) => `${Math.round(ms / 60_000)} minutes`;
const plural = (n: number) => `${n} agent${n === 1 ? "" : "s"}`;

const KIND: Record<Extract<RecoveryKind, "revoke" | "sweep">, { action: string; done: string }> = {
  revoke: { action: "Revoke session key", done: "Session key revoked" },
  sweep: { action: "Withdraw funds to my wallet", done: "Funds sent to your wallet" },
};
type Kind = keyof typeof KIND;

interface Waiting {
  hold: RecoveryHold;
  readyAt: number;
}

/**
 * Bulk recovery hold, decided by the real rule in @monadeum/recovery/decide.
 * State is client-only: nothing is revoked or withdrawn.
 */
export function RecoveryPanel({ agents, priorAgentId }: { agents: PickableAgent[]; priorAgentId: string | null }) {
  const [picks, setPicks] = useState<string[]>([]);
  // one recovery already ran in this window, so the distinct limit is visible in the demo
  const [priors, setPriors] = useState<PriorRecovery[]>(() =>
    priorAgentId ? [{ rootWalletId: ROOT_WALLET, agentId: priorAgentId, at: Date.now() - 20 * 60_000 }] : [],
  );
  const [pending, setPending] = useState<RecoveryHold | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [message, setMessage] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const byId = new Map(agents.map((a) => [a.id, a]));

  const decide = (kind: Kind) => decideRecovery({ rootWalletId: ROOT_WALLET, agentIds: picks, kind, now: Date.now(), priors });
  const preview = picks.length ? decide("revoke") : null;
  const recent = new Set(priors.filter((p) => p.at >= Date.now() - RECOVERY_WINDOW_MS).map((p) => p.agentId)).size;

  const toggle = (id: string, on: boolean) => {
    setPicks((xs) => (on ? [...xs, id] : xs.filter((x) => x !== id)));
    setPending(null);
    setMessage("");
  };

  const run = (kind: Kind) => {
    const d = decide(kind);
    if (d.outcome === "execute") {
      const now = Date.now();
      setPriors((ps) => [...ps, ...d.agentIds.map((agentId) => ({ rootWalletId: ROOT_WALLET, agentId, at: now }))]);
      setMessage(`${KIND[kind].done} for ${d.agentIds.map((id) => (byId.get(id) ? agentLabel(byId.get(id)!) : id)).join(", ")}.`);
      setPicks([]);
      setPending(null);
    } else if (d.outcome === "hold") {
      setPending(d.hold);
      setMessage("");
      requestAnimationFrame(() => confirmRef.current?.focus());
    }
  };

  const confirm = () => {
    if (!pending) return;
    const d = confirmHold(pending, pending.agentIds.length, Date.now());
    if (d.outcome === "wait") {
      setWaiting({ hold: d.hold, readyAt: d.readyAt });
      setPending(null);
      setPicks([]);
      setMessage(`Held. ${KIND[d.hold.kind as Kind].action} for ${plural(d.hold.agentIds.length)} runs in ${minutes(RECOVERY_DELAY_MS)}.`);
    } else if (d.outcome === "reject") setMessage("The confirmed count did not match the selection. Nothing was held.");
  };

  const overLimitSingle = preview?.outcome === "hold" && picks.length === 1;

  return (
    <Card>
      <CardHead title="Revoke or withdraw funds">
        <span className="flex flex-wrap items-center gap-2">
          <SampleBadge>Sample agents</SampleBadge>
          <span className="text-[13px] text-muted">An action on a single agent runs immediately</span>
        </span>
      </CardHead>
      <p className="mb-3.5 max-w-[70ch] text-sm text-muted">
        If an action affects several agents at once, or more than {RECOVERY_DISTINCT_LIMIT} distinct agents within {minutes(RECOVERY_WINDOW_MS)}, it is held: it needs a second
        confirmation and a {minutes(RECOVERY_DELAY_MS)} wait. This protects your population if someone gains access to your account.
      </p>

      <fieldset>
        <legend className="sr-only">Agents to act on</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {agents.map((a) => {
            const id = `pick-${a.id}`;
            return (
              <label
                key={a.id}
                htmlFor={id}
                className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5 text-sm has-checked:outline-[1.5px] has-checked:outline-accent has-focus-visible:outline-2 has-focus-visible:outline-accent-hi"
              >
                <input id={id} type="checkbox" checked={picks.includes(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} className="accent-accent" />
                <Identicon agent={a} className="size-6 rounded-[7px]" />
                <span className="min-w-0 truncate">{agentLabel(a)}</span>
                <span className="ml-auto font-mono text-muted tabular">{usd(a.capital)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-3.5 flex flex-wrap gap-2.5">
        <button type="button" className="btn" disabled={!picks.length} onClick={() => run("revoke")}>
          <Icon name="key" />
          {KIND.revoke.action}
        </button>
        <button type="button" className="btn" disabled={!picks.length} onClick={() => run("sweep")}>
          <Icon name="wallet" />
          {KIND.sweep.action}
        </button>
      </div>

      <div className="mt-3.5 grid gap-3">
        {preview?.outcome === "execute" && (
          <p className="flex items-center gap-2 text-[13px] text-muted">
            <Icon name="check" className="size-4 text-good" />
            Runs immediately. {plural(recent)} affected in the last {minutes(RECOVERY_WINDOW_MS)} so far.
          </p>
        )}
        {preview?.outcome === "hold" && (
          <div className="grid gap-2.5 rounded-[14px] border border-warn bg-warn-wash p-4 text-sm">
            <b className="flex items-center gap-2 text-warn">
              <Icon name="lock" className="size-4" />
              {pending ? `${KIND[pending.kind as Kind].action} is held` : "This action will be held"}
            </b>
            <span>
              Affects {plural(picks.length)}
              {overLimitSingle ? ` and would exceed ${RECOVERY_DISTINCT_LIMIT} distinct agents in the last ${minutes(RECOVERY_WINDOW_MS)}` : ""}. To continue, confirm the number of
              agents and wait {minutes(RECOVERY_DELAY_MS)}. There is no way to skip the wait.
            </span>
            {pending ? (
              <div className="flex flex-wrap gap-2.5">
                <button ref={confirmRef} type="button" className="btn" onClick={confirm}>
                  Confirm {plural(pending.agentIds.length)} and start the wait
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <span className="text-[13px] text-muted">Choose an action above to request the hold.</span>
            )}
          </div>
        )}
        {waiting && (
          <div className="grid gap-2.5 rounded-[14px] border border-warn bg-warn-wash p-4 text-sm">
            <b className="text-warn">
              Held. {KIND[waiting.hold.kind as Kind].action} for {plural(waiting.hold.agentIds.length)} runs in {minutes(RECOVERY_DELAY_MS)}, at{" "}
              {new Date(waiting.readyAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </b>
            <span>We will notify you before it runs. You can cancel it until then.</span>
            <div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setWaiting(null);
                  setMessage("Held action cancelled. Nothing ran.");
                }}
              >
                Cancel held action
              </button>
            </div>
          </div>
        )}
        <p role="status" aria-live="polite" className="text-[13px] text-fg empty:hidden">
          {message}
        </p>
      </div>
    </Card>
  );
}
