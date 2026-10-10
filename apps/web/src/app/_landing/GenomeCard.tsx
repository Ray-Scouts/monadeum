import type { ReactNode } from "react";
import { PROTOCOL } from "monadeum-simulation/protocol";
import s from "./landing.module.css";

interface Gene {
  key: string;
  value: number;
  min: number;
  max: number;
  color: string;
  fmt: (v: number) => string;
}

/** Sample genome. Bounds are the protocol's ranges. */
const GENES: readonly Gene[] = [
  { key: "Risk tolerance", value: 0.12, min: PROTOCOL.riskFloor, max: PROTOCOL.riskCeiling, color: "var(--accent)", fmt: (v) => v.toFixed(3) },
  { key: "Execution frequency", value: 8, min: PROTOCOL.frequencyMin, max: PROTOCOL.frequencyMax, color: "var(--sky)", fmt: (v) => String(Math.round(v)) },
  { key: "Time horizon", value: 24, min: PROTOCOL.timeHorizonMin, max: PROTOCOL.timeHorizonMax, color: "var(--mint)", fmt: (v) => `${Math.round(v)}t` },
  { key: "x402 budget", value: 0.05, min: 0, max: PROTOCOL.informationBudgetCeiling, color: "var(--berry)", fmt: (v) => `$${v.toFixed(3)}` },
  { key: "Entry threshold", value: 0.3, min: PROTOCOL.thresholdMin, max: PROTOCOL.thresholdMax, color: "var(--sun)", fmt: (v) => v.toFixed(2) },
];

/** A sample genome against the protocol bounds. The genome is fixed for the agent's life, so nothing here changes. */
export function GenomeCard({ children, footnote }: { children: ReactNode; footnote: ReactNode }) {
  return (
    <div className={s.split}>
      <div className="min-w-0">
        {children}
        {footnote}
      </div>
      <div className={s.genomeCard}>
        <div className="mb-2.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="eyebrow">Sample genome · fixed at creation</span>
            <div className="mt-1 font-display text-2xl font-bold">Kestrel·a1f0</div>
          </div>
        </div>
        {GENES.map((g) => (
          <div key={g.key} className={s.gene}>
            <span className="min-w-0">
              {g.key}
              <small>
                {g.min} to {g.max}
              </small>
            </span>
            <div className={s.gbar} aria-hidden="true">
              <span style={{ width: `${((g.value - g.min) / (g.max - g.min)) * 100}%`, background: g.color }} />
              <i title="Protocol cap" />
            </div>
            <output>{g.fmt(g.value)}</output>
          </div>
        ))}
      </div>
    </div>
  );
}
