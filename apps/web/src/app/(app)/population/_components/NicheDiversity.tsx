import { RISK_CUTS, riskBand } from "@monadeum/fitness/math";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { Card, CardHead } from "@/components/ui";
import type { Agent } from "@/data/types";

const BAND_COLORS = ["var(--sky)", "var(--mint)", "var(--accent)", "var(--berry)", "var(--sun)"] as const;

/** Band edges: the protocol risk floor, the fitness cuts, then the risk ceiling. */
const EDGES = [PROTOCOL.riskFloor, ...RISK_CUTS, PROTOCOL.riskCeiling];
const BANDS = EDGES.slice(0, -1).map((lo, i) => `${lo.toFixed(2)} to ${EDGES[i + 1]!.toFixed(2)}`);

export function NicheDiversity({ live }: { live: Agent[] }) {
  const counts = BANDS.map((_, i) => live.filter((a) => riskBand(a.genome.riskTolerance) === i).length);
  const total = Math.max(1, live.length);
  const trigger = Math.round(PROTOCOL.nicheShareThreshold * 100);
  const penalized = Math.round(PROTOCOL.penalizedPercentile * 100);
  const summary = counts.map((c, i) => `${BANDS[i]}: ${c} agents`).join("; ");

  return (
    <Card>
      <CardHead title="Diversity by risk band" />
      <p className="mb-6 text-[13px] text-muted">
        If a niche exceeds {trigger}% of the live population, its agents need the {penalized}th percentile to reproduce, and their mutation rate is
        proposed to double. A niche also includes the asset universe; this view groups by risk band only.
      </p>
      <div className="relative">
        <div role="img" aria-label={`Live agents by risk band. ${summary}. Trigger at ${trigger}%.`} className="flex h-[42px] gap-0.5 overflow-hidden rounded-xl">
          {counts.map((c, i) =>
            c ? <div key={i} className="min-w-0" style={{ flex: c, background: BAND_COLORS[i] }} title={`${BANDS[i]}: ${c} agents`} /> : null,
          )}
        </div>
        <span aria-hidden="true" className="absolute -top-1.5 -bottom-1.5 w-0.5 bg-berry" style={{ left: `${trigger}%` }}>
          <span className="absolute -top-[18px] left-1 font-mono text-[11px] font-medium whitespace-nowrap text-berry">{trigger}% trigger</span>
        </span>
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted sm:grid-cols-5">
        {BANDS.map((label, i) => {
          const share = counts[i]! / total;
          const over = share > PROTOCOL.nicheShareThreshold;
          return (
            <li key={label}>
              <b className={`block font-mono text-[13px] font-semibold tabular ${over ? "text-warn" : "text-fg"}`}>{Math.round(share * 100)}%</b>
              <span className="mr-1.5 inline-block size-2 rounded-[2px]" style={{ background: BAND_COLORS[i] }} aria-hidden="true" />
              {label}
              <span className="block text-faint">
                {counts[i]} {counts[i] === 1 ? "agent" : "agents"}
                {over && ", above trigger"}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
