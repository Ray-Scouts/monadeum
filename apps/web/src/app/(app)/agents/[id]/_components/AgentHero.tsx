"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Identicon, SampleBadge, StatusPill } from "@/components/ui";
import type { Agent, AgentStatus } from "@/data/types";
import { agentLabel, shortAddress } from "@/lib/format";
import { CopyButton } from "./CopyButton";

/**
 * Agent identity, status and owner actions. Pause and Retire only change local state:
 * there is no API yet, so nothing is persisted and the page says so.
 */
export function AgentHero({
  agent,
  owner,
  sample,
}: {
  agent: Agent;
  owner: { id: string; name: string } | null;
  sample: boolean;
}) {
  const [status, setStatus] = useState<AgentStatus>(agent.status);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const retireRef = useRef<HTMLButtonElement>(null);
  const label = agentLabel(agent);
  const resumeTo: AgentStatus = agent.status === "paused" ? "active" : agent.status;
  const suffix = sample ? " Sample data: this change is not saved." : "";

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  function togglePause() {
    const next = status === "paused" ? resumeTo : "paused";
    setStatus(next);
    setMessage(`${next === "paused" ? "Agent paused." : "Agent resumed."}${suffix}`);
  }

  function cancelRetire() {
    setConfirming(false);
    retireRef.current?.focus();
  }

  function retire() {
    setConfirming(false);
    setStatus("retired");
    setMessage(`${label} retired.${suffix}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-5">
        <Identicon agent={{ ...agent, status }} className="size-[72px] rounded-[20px]" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[clamp(28px,3.4vw,40px)] font-bold break-all">{label}</h1>
            <StatusPill agent={{ ...agent, status }} />
            {sample && <SampleBadge />}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
            {owner && (
              <span>
                Owned by{" "}
                <Link href={`/capital-flow?owner=${owner.id}`} className="tap-y inline-flex items-center font-semibold text-accent-hi hover:underline">
                  {owner.name}
                </Link>
              </span>
            )}
            <span
              title={`Agent's ERC-4337 smart account: ${agent.address}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line-soft bg-surface-2 px-2 py-1 font-mono text-[13px] text-fg"
            >
              <span className="sr-only">Smart account address </span>
              <span className="sm:hidden">{shortAddress(agent.address)}</span>
              <span className="hidden break-all sm:inline">{agent.address}</span>
              <CopyButton value={agent.address} label="Copy address" />
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 md:ml-auto">
          {status === "retired" ? (
            <span className="text-[13px] text-muted">Retired. Its balance stays in its account and you can recover it.</span>
          ) : (
            <>
              <button type="button" className="btn" onClick={togglePause}>
                <Icon name={status === "paused" ? "arrow" : "pause"} />
                {status === "paused" ? "Resume" : "Pause"}
              </button>
              <button
                ref={retireRef}
                type="button"
                className="btn btn-danger"
                aria-expanded={confirming}
                aria-controls="retire-confirm"
                onClick={() => setConfirming(true)}
              >
                <Icon name="stop" />
                Retire agent
              </button>
            </>
          )}
        </div>
      </div>

      {confirming && status !== "retired" && (
        <div
          id="retire-confirm"
          role="group"
          aria-labelledby="retire-confirm-text"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-bad bg-bad-wash p-3.5 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Escape") cancelRetire();
          }}
        >
          <span className="text-bad">
            <Icon name="alert" />
          </span>
          <span id="retire-confirm-text" className="min-w-[200px] flex-1">
            Retiring <b>{label}</b> revokes its session key and stops its ticks. Its history and balance are kept.
          </span>
          <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={cancelRetire}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={retire}>
            Yes, retire
          </button>
        </div>
      )}

      <p role="status" className="text-[13px] text-muted empty:hidden">
        {message}
      </p>
    </div>
  );
}
