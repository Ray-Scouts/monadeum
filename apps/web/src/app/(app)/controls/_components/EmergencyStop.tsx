"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Card, CardHead } from "@/components/ui";
import { Icon } from "@/components/Icon";

/** How long the button must be held. An interaction constant of this screen, not a protocol value. */
const HOLD_MS = 1500;

type State = "idle" | "holding" | "stopped";

/** Press-and-hold stop: pointer or Space/Enter, held for HOLD_MS. Releasing early cancels. */
export function EmergencyStop() {
  const [state, setState] = useState<State>("idle");
  const fill = useRef<HTMLSpanElement>(null);
  const raf = useRef(0);
  const t0 = useRef(0);
  const stopped = useRef(false);
  const hintId = useId();

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const paint = (p: number) => {
    if (fill.current) fill.current.style.transform = `scaleX(${p})`;
  };

  const frame = (now: number) => {
    const p = Math.min(1, (now - t0.current) / HOLD_MS);
    paint(p);
    if (p >= 1) {
      stopped.current = true;
      setState("stopped");
    } else raf.current = requestAnimationFrame(frame);
  };

  const start = () => {
    if (stopped.current || raf.current) return;
    t0.current = performance.now();
    setState("holding");
    raf.current = requestAnimationFrame(frame);
  };

  const cancel = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    if (!stopped.current) {
      paint(0);
      setState("idle");
    }
  };

  const resume = () => {
    stopped.current = false;
    raf.current = 0;
    paint(0);
    setState("idle");
  };

  const isKey = (k: string) => k === " " || k === "Enter";

  return (
    <Card>
      <CardHead title="Emergency stop" />
      <p id={hintId} className="mb-3.5 text-[13px] text-muted">
        Press and hold for {HOLD_MS / 1000} seconds to stop scheduling ticks for all your agents. No open position is force-liquidated.
      </p>
      <button
        type="button"
        aria-describedby={hintId}
        aria-disabled={state === "stopped"}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.focus();
          start();
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (!isKey(e.key)) return;
          e.preventDefault();
          if (!e.repeat) start();
        }}
        onKeyUp={(e) => {
          if (!isKey(e.key)) return;
          e.preventDefault();
          cancel();
        }}
        onBlur={cancel}
        className="relative flex w-full touch-none items-center justify-center gap-2.5 overflow-hidden rounded-2xl border-[1.5px] border-bad bg-bad-wash p-[18px] font-display text-[17px] font-bold text-bad select-none aria-disabled:cursor-default"
      >
        <span ref={fill} aria-hidden="true" className="absolute inset-0 origin-left scale-x-0 bg-bad opacity-25" />
        <span className="relative flex items-center gap-2.5">
          <Icon name="stop" />
          {state === "stopped" ? "Population stopped, nothing liquidated" : state === "holding" ? "Keep holding" : "Hold to stop everything"}
        </span>
      </button>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p role="status" aria-live="polite" className="text-[13px] text-muted">
          {state === "stopped" ? "Stop engaged. No agent will receive new ticks. Open positions were left as they are." : ""}
        </p>
        {state === "stopped" && (
          <button type="button" className="btn btn-ghost" onClick={resume}>
            Resume ticks
          </button>
        )}
      </div>
    </Card>
  );
}
