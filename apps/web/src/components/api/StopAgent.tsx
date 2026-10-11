"use client";

import { RECOVERY_DELAY_MS } from "@monadeum/recovery/decide";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Card, CardHead, Pill } from "@/components/ui";
import { isApiError } from "@/data/api/client";
import { revocationFacts, STOP_COPY, stopViewFromError, stopViewFromOperation, stopViewFromResponse, type StopView } from "@/data/api/stop";
import type { ApiAgent, Operation, RevocationStatus } from "@/data/api/types";
import { useSession } from "./auth";
import { errorText } from "./ErrorNote";
import { OperationSigner } from "./OperationSigner";

export type RevocationRead = { status: RevocationStatus } | { unavailable: string } | null;

export interface StopPanelProps {
  agentName: string;
  session: ApiAgent["session"];
  view: StopView;
  confirming: boolean;
  revocation: RevocationRead;
  holdReadyAt: number | null;
  now: number;
  onOpen(): void;
  onCancel(): void;
  onConfirm(): void;
  onConfirmHold(): void;
  onReleaseHold(): void;
  /** The owner-signature step of a stop in progress. */
  signer?: ReactNode;
}

const TONE: Record<StopView["state"], "bad" | "warn" | "good" | "off"> = {
  idle: "off",
  requesting: "off",
  unavailable: "warn",
  "no-session": "off",
  held: "warn",
  stopping: "warn",
  stopped: "good",
  failed: "bad",
  error: "bad",
};

/**
 * "Stop this agent" (issue #44): one button and one confirmation, so two interactions from the per-agent view. It is
 * labeled as an emergency stop and says how it differs from retirement. Its status lines come from the API only.
 */
export function StopPanel(p: StopPanelProps) {
  const stopped = p.session?.status === "revoked" || p.view.state === "stopped";
  const noKey = p.session === null;
  const inFlight = p.view.state === "requesting" || p.view.state === "stopping" || p.view.state === "held";
  const facts = p.revocation && "status" in p.revocation ? revocationFacts(p.revocation.status) : null;
  return (
    <Card className="border-bad/40">
      <CardHead title="Stop this agent">
        <Pill tone="bad">Emergency stop</Pill>
      </CardHead>
      <p className="text-[13px] text-muted">{STOP_COPY.what}</p>
      <p className="mt-1.5 text-[13px] text-muted">{STOP_COPY.notRetirement}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!p.confirming && (
          <button
            type="button"
            className="btn btn-danger"
            aria-expanded={p.confirming}
            aria-controls="stop-confirm"
            disabled={stopped || noKey || inFlight}
            onClick={p.onOpen}
          >
            <Icon name="stop" />
            {stopped ? "Stopped" : "Stop this agent"}
          </button>
        )}
        {noKey && <span className="text-[13px] text-muted">No session key has been issued, so this agent cannot transact. There is nothing to stop.</span>}
      </div>

      {p.confirming && (
        <div
          id="stop-confirm"
          role="group"
          aria-labelledby="stop-confirm-text"
          className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-bad bg-bad-wash p-3.5 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Escape") p.onCancel();
          }}
        >
          <span className="text-bad">
            <Icon name="alert" />
          </span>
          <span id="stop-confirm-text" className="min-w-[200px] flex-1">
            {STOP_COPY.confirm} Agent: <b>{p.agentName}</b>.
          </span>
          <button type="button" className="btn btn-ghost" onClick={p.onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={p.onConfirm}>
            Yes, stop now
          </button>
        </div>
      )}

      <div role="status" aria-live="polite" className="mt-3 flex flex-col gap-3 text-sm empty:hidden">
        {p.view.state === "requesting" && <span className="text-muted">Sending the stop request…</span>}
        {"message" in p.view && (
          <span className="flex items-start gap-2">
            <Pill tone={TONE[p.view.state]}>{p.view.state === "no-session" ? "nothing to stop" : p.view.state}</Pill>
            <span>{p.view.message}</span>
          </span>
        )}
      </div>

      {p.view.state === "held" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {p.view.hold.confirmedAt === null && p.holdReadyAt === null ? (
            <button type="button" className="btn" onClick={p.onConfirmHold}>
              Confirm: this affects {p.view.hold.agentIds.length} {p.view.hold.agentIds.length === 1 ? "agent" : "agents"}
            </button>
          ) : (
            <button type="button" className="btn btn-danger" disabled={p.holdReadyAt !== null && p.now < p.holdReadyAt} onClick={p.onReleaseHold}>
              {p.holdReadyAt !== null && p.now < p.holdReadyAt ? `Release available at ${new Date(p.holdReadyAt).toLocaleTimeString()}` : "Release the hold and stop"}
            </button>
          )}
        </div>
      )}

      {p.signer && <div className="mt-3">{p.signer}</div>}

      <div className="mt-4 border-t border-line-soft pt-3 text-[13px]">
        <span className="eyebrow">Revocation status, read from chain</span>
        {facts ? (
          <>
            <p className="mt-1.5 font-medium">{facts.verdict}</p>
            <ul className="m-0 mt-1 list-disc pl-5 font-mono text-xs text-muted">
              {facts.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-1.5 text-muted">{p.revocation && "unavailable" in p.revocation ? p.revocation.unavailable : "Reading…"}</p>
        )}
      </div>
    </Card>
  );
}

function revocationText(error: unknown): string {
  if (isApiError(error, "no-session")) return "No session key has been issued for this agent.";
  if (isApiError(error) && error.status === 503) return "Not available on this server: it has no chain or session key vault configured, so it cannot read the account's permission state.";
  return errorText(error);
}

export function StopAgent({ agent, onChanged }: { agent: ApiAgent; onChanged(): void }) {
  const session = useSession();
  const [view, setView] = useState<StopView>({ state: "idle" });
  const [confirming, setConfirming] = useState(false);
  const [revocation, setRevocation] = useState<RevocationRead>(null);
  const [holdReadyAt, setHoldReadyAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const readRevocation = useCallback(() => {
    if (!session) return;
    session
      .revocation(agent.id)
      .then((status) => setRevocation({ status }))
      .catch((e: unknown) => setRevocation({ unavailable: revocationText(e) }));
  }, [session, agent.id]);

  useEffect(readRevocation, [readRevocation]);

  // A stop held by the bulk recovery rule survives a reload: the API lists the caller's open holds.
  useEffect(() => {
    if (!session) return;
    session
      .holds()
      .then(({ holds }) => {
        const hold = holds.find((h) => !h.released && h.agentIds.includes(agent.id));
        if (!hold) return;
        if (hold.confirmedAt !== null) setHoldReadyAt(hold.confirmedAt + RECOVERY_DELAY_MS);
        setView((v) => (v.state === "idle" ? stopViewFromResponse({ status: "held", hold }) : v));
      })
      .catch(() => undefined);
  }, [session, agent.id]);

  useEffect(() => {
    if (holdReadyAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [holdReadyAt]);

  const settle = (next: StopView) => {
    setView(next);
    readRevocation();
    onChangedRef.current();
  };

  async function confirm() {
    if (!session) return;
    setConfirming(false);
    setView({ state: "requesting" });
    try {
      settle(stopViewFromResponse(await session.stop(agent.id)));
    } catch (e) {
      settle(stopViewFromError(e));
    }
  }

  async function confirmHold() {
    if (!session || view.state !== "held") return;
    try {
      const r = await session.confirmHold(view.hold.id, view.hold.agentIds.length);
      setHoldReadyAt(r.readyAt);
      setView(stopViewFromResponse({ status: "held", hold: r.hold }));
    } catch (e) {
      setView(stopViewFromError(e));
    }
  }

  async function releaseHold() {
    if (!session || view.state !== "held") return;
    try {
      settle(stopViewFromResponse(await session.releaseHold(view.hold.id)));
    } catch (e) {
      settle(stopViewFromError(e));
    }
  }

  const onOperation = (operation: Operation) => {
    const local = view.state === "stopping" ? view.local : [];
    const next = stopViewFromOperation(local, operation);
    if (next.state === "stopping") setView(next);
    else settle(next);
  };

  return (
    <StopPanel
      agentName={agent.name}
      session={agent.session}
      view={view}
      confirming={confirming}
      revocation={revocation}
      holdReadyAt={holdReadyAt}
      now={now}
      onOpen={() => setConfirming(true)}
      onCancel={() => setConfirming(false)}
      onConfirm={() => void confirm()}
      onConfirmHold={() => void confirmHold()}
      onReleaseHold={() => void releaseHold()}
      signer={view.state === "stopping" ? <OperationSigner operation={view.operation} name={(id) => (id === agent.id ? agent.name : id)} onChange={onOperation} /> : undefined}
    />
  );
}
