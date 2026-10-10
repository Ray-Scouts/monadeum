"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CAPITAL_FLOOR, EVALUATION_CADENCE, REALLOCATION_CAP, SLOT_CEILING } from "@monadeum/reallocation/constants";
import { useInView } from "./hooks";
import { REALLOC, money, percent } from "./numbers";
import s from "./landing.module.css";

const STEPS = ["Your agents trade", "The evaluation ranks them", "The lowest offers a capped share", "The highest takes it, up to its ceiling"];

interface Frame {
  values: { high: number; middle: number; low: number };
  /** Highest walkthrough step lit, or -1 for none. */
  lit: number;
  caption: string;
}

const R = REALLOC;
const start = { high: R.principal, middle: R.principal, low: R.principal };
const FRAMES: readonly Frame[] = [
  { values: start, lit: -1, caption: `One owner, three agents, ${money(R.principal)} of principal each. The owner has signed a policy that covers all three.` },
  { values: R.before, lit: 0, caption: `After trading they hold ${money(R.before.high)}, ${money(R.before.middle)} and ${money(R.before.low)}.` },
  { values: R.before, lit: 1, caption: `Every ${EVALUATION_CADENCE} ticks the evaluation ranks them, within this owner only. The agent in the middle is left alone.` },
  {
    values: R.before,
    lit: 2,
    caption: `The lowest offers ${percent(REALLOCATION_CAP)} of its capital, ${money(R.moved)}. It never goes below the ${money(CAPITAL_FLOOR)} floor.`,
  },
  {
    values: R.after,
    lit: 3,
    caption: `The highest takes it, staying under its ceiling of ${SLOT_CEILING} times principal. The lowest is now below its own principal, and the owner's total is still ${money(R.total)}.`,
  },
];
const FINAL = FRAMES.length - 1;

const w = (v: number) => `${Math.min(100, (v / R.scale) * 100)}%`;
const ROWS = [
  { key: "high", label: "Highest", cls: s.segUp },
  { key: "middle", label: "Middle", cls: s.segMid },
  { key: "low", label: "Lowest", cls: s.segDown },
] as const;

/** Walks through one reallocation between agents of the same owner. Every move figure comes from `planReallocation`. */
export function ReallocationDemo({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setI(FINAL);
      return;
    }
    if (!inView) return;
    const id = window.setInterval(() => setI((v) => (v + 1) % FRAMES.length), 2600);
    return () => window.clearInterval(id);
  }, [inView]);

  const f = FRAMES[i] ?? FRAMES[0]!;
  const total = f.values.high + f.values.middle + f.values.low;

  return (
    <div ref={ref} className={`${s.split} ${s.splitRev}`}>
      <div className="min-w-0">
        {children}
        <ol className={s.steps}>
          {STEPS.map((label, k) => (
            <li key={label} className={k <= f.lit ? s.on : ""}>{label}</li>
          ))}
        </ol>
      </div>
      <div className={s.flowCard}>
        {ROWS.map((row, k) => (
          <div key={row.key} className={s.rbarRow}>
            <span className="text-sm font-semibold">{row.label}</span>
            <div className={s.rbar}>
              <span className={`${s.seg} ${row.cls}`} style={{ width: w(f.values[row.key]) }} />
              <span className={s.thr} style={{ left: w(R.principal) }}>{k === 0 && <em>{money(R.principal)} principal</em>}</span>
            </div>
            <span className="text-right font-mono text-sm">{money(f.values[row.key])}</span>
          </div>
        ))}
        <p className={s.rCap}>{f.caption}</p>
        <div className="flex justify-between border-t border-line-soft pt-3.5 text-sm text-muted">
          <span>Owner&apos;s total</span>
          <b className="font-mono text-base text-fg">{money(total)}</b>
        </div>
      </div>
    </div>
  );
}
