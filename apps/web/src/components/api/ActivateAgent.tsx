"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Card, CardHead, Pill } from "@/components/ui";
import { ACTIVATE_COPY, activateViewFromError, activateViewFromOperation, sessionFacts, type ActivateView } from "@/data/api/activate";
import type { ApiAgent, Operation, SessionView } from "@/data/api/types";
import { WEB_CONFIG } from "@/data/config";
import { useSession } from "./auth";
import { OperationSigner } from "./OperationSigner";

export interface ActivatePanelProps {
  agent: ApiAgent;
  view: ActivateView;
  /** The key as the chain reports it, when the agent has one. */
  session: SessionView | null;
  settlement: (typeof WEB_CONFIG)["settlement"];
  onActivate(): void;
  /** The owner-signature step of an activation in progress. */
  signer?: ReactNode;
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="m-0 mt-1 list-disc pl-5 text-[13px] text-muted">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

/**
 * "Activate this agent": shown on a deployed agent without a live session key. States what the key can and cannot
 * do before anything is signed, and that activation alone does not start trading. Once active, shows the key's state
 * as read from chain.
 */
export function ActivatePanel(p: ActivatePanelProps) {
  const active = p.view.state === "active" || p.agent.session?.status === "active";
  const stoppedBefore = p.agent.session?.status === "revoked";
  const busy = p.view.state === "requesting" || p.view.state === "signing";
  const facts = p.session ? sessionFacts(p.session) : p.view.state === "active" && p.view.session ? sessionFacts(p.view.session) : null;
  return (
    <Card>
      <CardHead title={active ? "Session key" : stoppedBefore ? "Activate this agent again" : "Activate this agent"}>
        <Pill tone={active ? "accent" : "off"}>{active ? "Active" : "Not active"}</Pill>
      </CardHead>
      {!active && (
        <>
          <p className="text-[13px] text-muted">{stoppedBefore ? ACTIVATE_COPY.again : ACTIVATE_COPY.what}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <span className="eyebrow">The key can</span>
              <List items={ACTIVATE_COPY.can(p.agent, p.settlement)} />
            </div>
            <div>
              <span className="eyebrow">The key cannot</span>
              <List items={ACTIVATE_COPY.cannot} />
            </div>
          </div>
          <p className="mt-2 text-[13px] text-muted">{ACTIVATE_COPY.limit}</p>
          <p className="mt-1.5 text-[13px] text-muted">{ACTIVATE_COPY.stop}</p>
        </>
      )}
      <p role="note" className="mt-3 rounded-xl border border-warn bg-warn-wash px-4 py-3 text-sm text-warn">
        {ACTIVATE_COPY.testnet}
      </p>

      {!active && !p.signer && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={p.onActivate}>
            <Icon name="key" />
            {stoppedBefore ? "Activate again" : "Activate agent"}
          </button>
        </div>
      )}

      {p.signer && <div className="mt-3">{p.signer}</div>}

      <div role="status" aria-live="polite" className="mt-3 flex flex-col gap-2 text-sm empty:hidden">
        {p.view.state === "requesting" && <span className="text-muted">Preparing the approval…</span>}
        {"message" in p.view && <span className={p.view.state === "active" ? "" : "text-bad"}>{p.view.message}</span>}
      </div>

      {facts && (
        <div className="mt-4 border-t border-line-soft pt-3 text-[13px]">
          <span className="eyebrow">Session key, read from chain</span>
          <p className="mt-1.5 font-medium">{facts.verdict}</p>
          <ul className="m-0 mt-1 list-disc pl-5 font-mono text-xs break-all text-muted">
            {facts.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function ActivateAgent({ agent, onChanged }: { agent: ApiAgent; onChanged(): void }) {
  const session = useSession();
  const [view, setView] = useState<ActivateView>({ state: "idle" });
  const [chain, setChain] = useState<SessionView | null>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const readSession = useCallback(() => {
    if (!session || !agent.session) return;
    session
      .sessionStatus(agent.id)
      .then(setChain)
      .catch(() => setChain(null));
  }, [session, agent.id, agent.session]);

  useEffect(readSession, [readSession]);

  async function start() {
    if (!session) return;
    setView({ state: "requesting" });
    try {
      setView(activateViewFromOperation((await session.activate(agent.id)).operation));
    } catch (e) {
      setView(activateViewFromError(e));
    }
  }

  const onOperation = (operation: Operation) => {
    const next = activateViewFromOperation(operation);
    setView(next);
    if (next.state !== "signing") {
      readSession();
      onChangedRef.current();
    }
  };

  return (
    <ActivatePanel
      agent={agent}
      view={view}
      session={chain && chain.status === "active" ? chain : null}
      settlement={WEB_CONFIG.settlement}
      onActivate={() => void start()}
      signer={view.state === "signing" ? <OperationSigner operation={view.operation} name={() => agent.name} onChange={onOperation} /> : undefined}
    />
  );
}
