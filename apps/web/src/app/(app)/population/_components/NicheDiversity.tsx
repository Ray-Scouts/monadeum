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
  const summary = counts.map((c, i) => `${BANDS[i]}: ${c} agents`).join("; ");

  return (
    <Card>
      <CardHead title="Diversity by risk band" />
      <p className="mb-4 text-[13px] text-muted">
        Fitness and the starvation rule are measured within a niche. No genome is ever copied, so the set of strategies changes only when owners create or
        retire agents. A niche also includes the asset universe; this view groups by risk band only.
      </p>
      <div role="img" aria-label={`Live agents by risk band. ${summary}.`} className="flex h-[42px] gap-0.5 overflow-hidden rounded-xl">
        {counts.map((c, i) =>
          c ? <div key={i} className="min-w-0" style={{ flex: c, background: BAND_COLORS[i] }} title={`${BANDS[i]}: ${c} agents`} /> : null,
        )}
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted sm:grid-cols-5">
        {BANDS.map((label, i) => (
          <li key={label}>
            <b className="block font-mono text-[13px] font-semibold text-fg tabular">{Math.round((counts[i]! / total) * 100)}%</b>
            <span className="mr-1.5 inline-block size-2 rounded-[2px]" style={{ background: BAND_COLORS[i] }} aria-hidden="true" />
            {label}
            <span className="block text-faint">
              {counts[i]} {counts[i] === 1 ? "agent" : "agents"}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
