import { Card, CardHead, SampleBadge } from "@/components/ui";
import type { Limit, LimitLayer } from "@/data/types";
import { usd } from "@/lib/format";

const LAYER: Record<LimitLayer, { label: string; color: string }> = {
  "on-chain validation": { label: "On-chain · validation", color: "bg-accent" },
  "on-chain execution": { label: "On-chain · execution", color: "bg-accent" },
  "policy engine": { label: "Policy engine", color: "bg-berry" },
  paymaster: { label: "Paymaster", color: "bg-good" },
};

export function LimitsCard({ limits }: { limits: Limit[] }) {
  return (
    <Card>
      <CardHead title="Active limits">
        <SampleBadge>Sample values</SampleBadge>
      </CardHead>
      <ul className="grid gap-3">
        {limits.map((l) => {
          const fraction = l.cap > 0 ? Math.min(1, l.used / l.cap) : 0;
          const layer = LAYER[l.layer];
          return (
            <li key={l.label} className="grid gap-1.5">
              <div className="flex flex-wrap justify-between gap-x-3 text-sm">
                <span>{l.label}</span>
                <span className="font-mono tabular">
                  {usd(l.used)} of {usd(l.cap)}
                </span>
              </div>
              <div
                role="meter"
                aria-label={`${l.label} used`}
                aria-valuemin={0}
                aria-valuemax={l.cap}
                aria-valuenow={l.used}
                aria-valuetext={`${usd(l.used)} of ${usd(l.cap)}`}
                className="h-2 overflow-hidden rounded-full bg-surface-2"
              >
                <span className={`block h-full rounded-full ${fraction >= 0.8 ? "bg-warn" : layer.color}`} style={{ width: `${fraction * 100}%` }} />
              </div>
              <span className="font-mono text-[11px] text-faint">{layer.label}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
