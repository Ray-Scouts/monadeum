import { EVALUATION_CADENCE } from "@monadeum/reallocation/constants";
import { Card, CardHead, Pill, SampleBadge } from "@/components/ui";
import type { BreakerState } from "@/data/types";
import { pct } from "@/lib/format";

function Ring({ fraction }: { fraction: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const f = Math.min(1, Math.max(0, fraction));
  const stroke = f >= 1 ? "var(--bad)" : f >= 0.75 ? "var(--warn)" : "var(--good)";
  return (
    <svg width="110" height="110" viewBox="0 0 110 110" role="img" aria-label={`Capital at risk at ${pct(fraction)} of threshold`} className="flex-none">
      <circle cx="55" cy="55" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="12" />
      <circle cx="55" cy="55" r={r} fill="none" stroke={stroke} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 55 55)" />
      <text x="55" y="61" textAnchor="middle" className="font-display" style={{ fontSize: 22, fontWeight: 700, fill: "var(--fg)" }}>
        {pct(fraction)}
      </text>
    </svg>
  );
}

export function BreakerCard({ breaker }: { breaker: BreakerState }) {
  const tripped = breaker.capitalAtRiskFraction >= 1 || breaker.reallocationFraction >= 1;
  return (
    <Card>
      <CardHead title="Population circuit breaker">
        <span className="flex flex-wrap items-center gap-2">
          <SampleBadge />
          {tripped ? <Pill tone="bad">Tripped</Pill> : <Pill tone="good">Normal</Pill>}
        </span>
      </CardHead>
      <div className="flex flex-wrap items-center gap-5">
        <Ring fraction={breaker.capitalAtRiskFraction} />
        <div className="grid min-w-0 gap-2 text-sm">
          <div>
            <b className="tabular">{pct(breaker.capitalAtRiskFraction)}</b> <span className="text-muted">of the capital-at-risk threshold</span>
          </div>
          <div>
            <b className="tabular">{pct(breaker.reallocationFraction)}</b> <span className="text-muted">of the threshold for capital moved by reallocation per {EVALUATION_CADENCE} ticks</span>
          </div>
          <p className="max-w-[34ch] text-xs text-muted">If either crosses its threshold, ticks stop being scheduled and reallocation pauses until a person reviews it.</p>
        </div>
      </div>
    </Card>
  );
}
