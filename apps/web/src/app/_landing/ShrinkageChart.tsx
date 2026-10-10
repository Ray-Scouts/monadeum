"use client";

import { useId, useState, type ReactNode } from "react";
import { SHRINKAGE_K, shrinkageWeight } from "@monadeum/fitness/math";
import s from "./landing.module.css";

/** Illustrative inputs. The weight and the blend are the real fitness math. */
const RAW = 3.2;
const MEDIAN = 0.8;
const N_MAX = 150;
const WD = 520;
const HD = 300;
const P = { l: 40, r: 16, t: 18, b: 34 };

const x = (n: number) => P.l + (n / N_MAX) * (WD - P.l - P.r);
const y = (w: number) => P.t + (1 - w) * (HD - P.t - P.b);
const CURVE = Array.from({ length: N_MAX + 1 }, (_, n) => `${n ? "L" : "M"}${x(n).toFixed(1)},${y(shrinkageWeight(n, SHRINKAGE_K)).toFixed(1)}`).join("");

/** Slider over trade count, showing how much an agent's own record is trusted against the population median. */
export function ShrinkageChart({ children }: { children: ReactNode }) {
  const [n, setN] = useState(3);
  const id = useId();
  const w = shrinkageWeight(n, SHRINKAGE_K);
  const adjusted = w * RAW + (1 - w) * MEDIAN;

  return (
    <div className={s.split}>
      <div className="min-w-0">
        {children}
        <div className="grid gap-2 pt-[22px] pb-4">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={id} className="font-semibold">Agent&apos;s trades</label>
            <output htmlFor={id} className="font-mono font-semibold text-accent-hi">{n}</output>
          </div>
          <input id={id} type="range" min={0} max={N_MAX} value={n} onChange={(e) => setN(Number(e.target.value))} className={s.range} />
        </div>
        <div className={s.shrinkNums}>
          <div><span className="eyebrow">Raw Sortino</span><b>{RAW.toFixed(2)}</b></div>
          <div><span className="eyebrow">Population median</span><b>{MEDIAN.toFixed(2)}</b></div>
          <div className={s.hl}><span className="eyebrow">Adjusted fitness</span><b>{adjusted.toFixed(2)}</b></div>
        </div>
        <p className={s.fine}>Sample Sortino and median. The weight is n / (n + {SHRINKAGE_K}), the protocol&apos;s shrinkage constant.</p>
      </div>
      <div className="min-w-0 rounded-card border border-line-soft bg-surface p-4">
        <svg viewBox={`0 0 ${WD} ${HD}`} className={s.chart} role="img" aria-label={`Trust in its own record by number of trades. At ${n} trades the agent's record carries ${Math.round(w * 100)}% of the weight.`}>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={P.l} x2={WD - P.r} y1={y(t)} y2={y(t)} stroke="var(--line-soft)" />
              <text x={P.l - 8} y={y(t) + 4} textAnchor="end">{t * 100}%</text>
            </g>
          ))}
          <line x1={x(SHRINKAGE_K)} x2={x(SHRINKAGE_K)} y1={P.t} y2={HD - P.b} stroke="var(--berry)" strokeDasharray="4 4" />
          <text x={x(SHRINKAGE_K) + 6} y={P.t + 12} style={{ fill: "var(--berry)" }}>half trust at {SHRINKAGE_K} trades</text>
          <path d={`${CURVE}L${x(N_MAX)},${HD - P.b}L${x(0)},${HD - P.b}Z`} fill="var(--sky)" opacity={0.12} />
          <path d={CURVE} fill="none" stroke="var(--sky)" strokeWidth={2.5} />
          <line x1={x(n)} x2={x(n)} y1={y(w)} y2={HD - P.b} stroke="var(--fg)" strokeOpacity={0.3} />
          <circle cx={x(n)} cy={y(w)} r={7} fill="var(--sky)" stroke="var(--surface)" strokeWidth={3} />
          <text x={Math.min(x(n) + 12, WD - 150)} y={y(w) - 12} style={{ fill: "var(--fg)", fontWeight: 500 }}>trusts itself {Math.round(w * 100)}%</text>
          <text x={x(0)} y={HD - 10}>0</text>
          <text x={x(N_MAX)} y={HD - 10} textAnchor="end">{N_MAX} trades</text>
        </svg>
      </div>
    </div>
  );
}
