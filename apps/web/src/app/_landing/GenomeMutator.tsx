"use client";

import { useState, type ReactNode } from "react";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { Icon } from "@/components/Icon";
import s from "./landing.module.css";

interface Gene {
  key: string;
  value: number;
  min: number;
  max: number;
  int?: boolean;
  color: string;
  fmt: (v: number) => string;
}

/** Sample parent genome. Bounds are the protocol's clip ranges. */
const PARENT: readonly Gene[] = [
  { key: "Risk tolerance", value: 0.12, min: PROTOCOL.riskFloor, max: PROTOCOL.riskCeiling, color: "var(--accent)", fmt: (v) => v.toFixed(3) },
  { key: "Execution frequency", value: 8, min: PROTOCOL.frequencyMin, max: PROTOCOL.frequencyMax, int: true, color: "var(--sky)", fmt: (v) => String(Math.round(v)) },
  { key: "Time horizon", value: 24, min: PROTOCOL.timeHorizonMin, max: PROTOCOL.timeHorizonMax, int: true, color: "var(--mint)", fmt: (v) => `${Math.round(v)}t` },
  { key: "x402 budget", value: 0.05, min: 0, max: PROTOCOL.informationBudgetCeiling, color: "var(--berry)", fmt: (v) => `$${v.toFixed(3)}` },
  { key: "Entry threshold", value: 0.3, min: PROTOCOL.thresholdMin, max: PROTOCOL.thresholdMax, color: "var(--sun)", fmt: (v) => v.toFixed(2) },
];

/** Demo probability, raised above the protocol's so a change is visible on every click. */
const DEMO_P_MUT = 0.5;
const NAMES = ["Kestrel", "Lumen", "Vela", "Orca", "Quill", "Tern", "Wren"];

interface State {
  genes: Gene[];
  gen: number;
  changed: Set<number>;
  clipped: Set<number>;
}

const fresh = (): State => ({ genes: PARENT.map((g) => ({ ...g })), gen: 0, changed: new Set(), clipped: new Set() });

const hashOf = (genes: Gene[]) =>
  "0x" + genes.reduce((h, g) => (h * 31 + Math.round(g.value * 1000)) >>> 0, 7).toString(16).padStart(8, "0").slice(0, 8);

/** Interactive mutation demo. Randomness runs only in click handlers, never during render. */
export function GenomeMutator({ children, footnote }: { children: ReactNode; footnote: ReactNode }) {
  const [st, setSt] = useState<State>(fresh);

  const mutate = () =>
    setSt((prev) => {
      const gen = prev.gen + 1;
      const changed = new Set<number>();
      const clipped = new Set<number>();
      const genes = prev.genes.map((g, i) => {
        if (Math.random() >= DEMO_P_MUT && !(gen % 3 === 0 && i === 0)) return g;
        let nv = g.value + Math.abs(g.value || 1) * (Math.random() * 2 - 1) * PROTOCOL.mutBand;
        // Every third generation, push risk tolerance past its ceiling so clipping is shown.
        if (gen % 3 === 0 && i === 0) nv = g.max * 1.3;
        if (nv > g.max || nv < g.min) clipped.add(i);
        nv = Math.min(g.max, Math.max(g.min, nv));
        changed.add(i);
        return { ...g, value: g.int ? Math.round(nv) : nv };
      });
      if (!changed.size) {
        const g = genes[1]!;
        genes[1] = { ...g, value: Math.min(g.max, g.value + 1) };
        changed.add(1);
      }
      return { genes, gen, changed, clipped };
    });

  const name = `${NAMES[st.gen % NAMES.length]}·${(0xa1f0 + st.gen * 7919).toString(16).slice(-4)}`;

  return (
    <div className={s.split}>
      <div className="min-w-0">
        {children}
        <div className="mt-[22px] flex flex-wrap gap-2.5">
          <button type="button" className="btn btn-ink" onClick={mutate}>Mutate a child <Icon name="dna" /></button>
          <button type="button" className="btn" onClick={() => setSt(fresh())} disabled={st.gen === 0}>Back to parent</button>
        </div>
        {footnote}
      </div>
      <div className={s.genomeCard}>
        <div className="mb-2.5 flex items-start justify-between gap-3" aria-live="polite">
          <div className="min-w-0">
            <span className="eyebrow">{st.gen ? `Child · generation ${st.gen}` : "Parent · generation 0"}</span>
            <div className="mt-1 font-display text-2xl font-bold">{name}</div>
          </div>
          <span className="font-mono text-sm text-muted">{hashOf(st.genes)}</span>
        </div>
        {st.genes.map((g, i) => {
          const clipped = st.clipped.has(i);
          return (
            <div key={g.key} className={`${s.gene} ${st.changed.has(i) ? s.flash : ""} ${clipped ? s.clip : ""}`}>
              <span className="min-w-0">
                {g.key}
                <small>{g.min} to {g.max}{clipped ? " · clipped" : ""}</small>
              </span>
              <div className={s.gbar}>
                <span style={{ width: `${((g.value - g.min) / (g.max - g.min)) * 100}%`, background: g.color }} />
                <i title="Protocol cap" />
              </div>
              <output key={st.gen}>{g.fmt(g.value)}</output>
            </div>
          );
        })}
      </div>
    </div>
  );
}
