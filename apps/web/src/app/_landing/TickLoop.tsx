"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "./hooks";
import s from "./landing.module.css";

const STEPS = [
  { title: "Observe", body: "Reads prices and its own capital state." },
  { title: "Buy information", body: "Pays via x402 only when the expected value beats the price." },
  { title: "Propose", body: "Suggests a concrete trade within its genome." },
  { title: "Policy", body: "Caps, allowed contracts and budgets." },
  { title: "Execute", body: "Only approved actions reach Kuru from its smart account." },
  { title: "Evolve", body: "Its fitness updates. The best can have offspring." },
] as const;
const GATE = 3;

type Verdict = "ok" | "no" | null;

/**
 * Highlights one step of the tick at a time. At the policy gate, two out of three proposals
 * are approved; a rejected one sends the loop back to the start. Reduced motion shows the
 * gate with an approval and does not cycle.
 */
export function TickLoop() {
  const ref = useRef<HTMLOListElement>(null);
  const inView = useInView(ref);
  const [state, setState] = useState<{ i: number; n: number; verdict: Verdict }>({ i: 0, n: 0, verdict: null });

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setState({ i: GATE, n: 0, verdict: "ok" });
      return;
    }
    if (!inView) return;
    const id = window.setInterval(() => {
      setState(({ i, n, verdict }) => {
        const next = i === GATE && verdict === "no" ? 0 : (i + 1) % STEPS.length;
        if (next !== GATE) return { i: next, n, verdict };
        return { i: next, n: n + 1, verdict: n % 3 !== 2 ? "ok" : "no" };
      });
    }, 1300);
    return () => window.clearInterval(id);
  }, [inView]);

  return (
    <ol ref={ref} className={s.loop}>
      {STEPS.map((step, k) => (
        <li key={step.title} className={`${k === GATE ? s.gate : ""} ${k === state.i ? s.on : ""}`} aria-current={k === state.i ? "step" : undefined}>
          <b>{step.title}</b>
          <p>{step.body}</p>
          {k === GATE && (
            <span className={`${s.verdict} ${state.verdict === "ok" ? s.verdictOk : state.verdict === "no" ? s.verdictNo : ""}`}>
              {state.verdict === "ok" ? "Approved" : state.verdict === "no" ? "Rejected: cap" : ""}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
