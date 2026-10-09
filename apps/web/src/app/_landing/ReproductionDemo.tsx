"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { useInView } from "./hooks";
import { REPRO, money, percent } from "./numbers";
import s from "./landing.module.css";

const STEPS = ["Trades and builds profit", "Crosses the threshold", "Hands over part of the profit", "The child starts with that capital"];

interface Frame {
  profit: number;
  child: number | null;
  /** Highest walkthrough step lit, or -1 for none. */
  lit: number;
  caption: string;
}

const R = REPRO;
const FRAMES: readonly Frame[] = [
  { profit: 0, child: null, lit: -1, caption: `The parent trades with ${money(R.principal)} of principal.` },
  { profit: R.profit, child: null, lit: 0, caption: `It earns ${money(R.profit)} net after x402, gas, fees and slippage.` },
  { profit: R.profit, child: null, lit: 1, caption: `Its capital crosses ${money(R.threshold)}, principal plus ${percent(PROTOCOL.profitThresholdFraction)}, and it meets the other 4 conditions.` },
  { profit: R.profitAfter, child: R.childCapital, lit: 2, caption: `It hands over ${percent(PROTOCOL.reproductionFraction)} of its profit. Its ${money(R.principal)} principal stays intact.` },
  { profit: R.profitAfter, child: R.childCapital, lit: 3, caption: `The child is born with its own account and ${money(R.childCapital)}. The total is still ${money(R.capitalBefore)}: nothing was created.` },
];
const FINAL = FRAMES.length - 1;

const w = (v: number) => `${(v / R.scale) * 100}%`;

/** Walks through one reproduction. Every figure comes from `allocateCapital` with the protocol principal. */
export function ReproductionDemo({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setI(FINAL);
      return;
    }
    if (!inView) return;
    const id = window.setInterval(() => setI((v) => (v + 1) % FRAMES.length), 2400);
    return () => window.clearInterval(id);
  }, [inView]);

  const f = FRAMES[i] ?? FRAMES[0]!;
  const parentValue = R.principal + f.profit;
  const total = parentValue + (f.child ?? 0);

  return (
    <div ref={ref} className={`${s.split} ${s.splitRev}`}>
      <div className="min-w-0">
        {children}
        <ol className={s.reproSteps}>
          {STEPS.map((label, k) => (
            <li key={label} className={k <= f.lit ? s.on : ""}>{label}</li>
          ))}
        </ol>
      </div>
      <div className={s.reproCard}>
        <div className={s.rbarRow}>
          <span className="text-sm font-semibold">Parent</span>
          <div className={s.rbar}>
            <span className={`${s.seg} ${s.segPrincipal}`} style={{ width: w(R.principal) }}>{money(R.principal)} principal</span>
            <span className={`${s.seg} ${s.segProfit}`} style={{ width: w(f.profit) }}>{f.profit > 0 ? `+${money(f.profit)}` : ""}</span>
            <span className={s.thr} style={{ left: w(R.threshold) }}><em>{money(R.threshold)} threshold</em></span>
          </div>
          <span className="text-right font-mono text-sm">{money(parentValue)}</span>
        </div>
        <div className={s.rbarRow}>
          <span className="text-sm font-semibold">Child</span>
          <div className={s.rbar}>
            <span className={`${s.seg} ${s.segChild}`} style={{ width: f.child ? w(f.child) : "0%" }}>{f.child ? money(f.child) : ""}</span>
          </div>
          <span className="text-right font-mono text-sm">{f.child ? money(f.child) : "·"}</span>
        </div>
        <p className={s.rCap}>{f.caption}</p>
        <div className="flex justify-between border-t border-line-soft pt-3.5 text-sm text-muted">
          <span>Total system capital</span>
          <b className="font-mono text-base text-fg">{money(total)}</b>
        </div>
      </div>
    </div>
  );
}
