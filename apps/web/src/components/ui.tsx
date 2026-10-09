import type { ReactNode } from "react";
import { isEligible } from "@/data/eligibility";
import type { Agent } from "@/data/types";

export type Tone = "good" | "warn" | "bad" | "accent" | "berry" | "off";

const TONE: Record<Tone, string> = {
  good: "bg-good-wash text-good",
  warn: "bg-warn-wash text-warn",
  bad: "bg-bad-wash text-bad",
  accent: "bg-accent-wash text-accent-hi",
  berry: "bg-berry-wash text-berry",
  off: "bg-surface-2 text-faint",
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function StatusPill({ agent, populationSize }: { agent: Agent; populationSize: number }) {
  if (agent.status === "retired") return <Pill tone="off">Retired</Pill>;
  if (agent.status === "review") return <Pill tone="warn">In review</Pill>;
  if (agent.status === "paused") return <Pill tone="off">Paused</Pill>;
  if (isEligible(agent, populationSize)) return <Pill tone="good">Eligible</Pill>;
  return <Pill tone="accent">Active</Pill>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`min-w-0 rounded-card border border-line-soft bg-surface p-5 ${className}`}>{children}</div>;
}

export function CardHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-bold">{title}</h3>
      {children}
    </div>
  );
}

export function Kpi({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[14px] border border-line-soft bg-surface px-[18px] py-4">
      <span className="eyebrow">{label}</span>
      <span className="font-display text-[26px] leading-tight font-bold tabular">{value}</span>
      {detail && <span className="text-xs text-muted">{detail}</span>}
    </div>
  );
}

export function SampleBadge({ children = "Sample data" }: { children?: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-wash px-2.5 py-1 text-xs text-warn">{children}</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-block rounded-md border border-line-soft bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted">{children}</span>;
}

export function ScreenHead({ title, children, aside }: { title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[clamp(26px,3vw,36px)] font-bold">{title}</h1>
        {children && <p className="mt-1.5 max-w-[64ch] text-muted">{children}</p>}
      </div>
      {aside}
    </div>
  );
}

/** Area sparkline with an emphasized endpoint. Color is a CSS color or variable. */
export function Sparkline({ values, width = 110, height = 30, color = "var(--accent)", label }: { values: number[]; width?: number; height?: number; color?: string; label?: string }) {
  const min = Math.min(...values), max = Math.max(...values), sx = width / Math.max(1, values.length - 1);
  const y = (v: number) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${(i * sx).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={`${d}L${width},${height}L0,${height}Z`} fill={color} opacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} />
      <circle cx={width} cy={y(values[values.length - 1] ?? 0)} r={2.5} fill={color} />
    </svg>
  );
}

/** Symmetric 5x5 identicon derived from the genome hash. */
export function Identicon({ agent, className = "size-[30px] rounded-[9px]" }: { agent: Pick<Agent, "genome" | "generation" | "status">; className?: string }) {
  const h = agent.genome.hash.slice(2).padEnd(8, "0");
  const hue = (parseInt(h.slice(0, 2), 16) % 160) + 150;
  const dim = agent.status === "retired";
  const cells: [number, number][] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (parseInt(h[(y * 3 + x) % 8]!, 16) % 2) { cells.push([x, y]); if (x < 2) cells.push([4 - x, y]); }
  const fg = dim ? "var(--faint)" : `hsl(${hue} 80% ${agent.generation % 2 ? 72 : 64}%)`;
  return (
    <svg viewBox="0 0 7 7" className={`block flex-none ${className}`} aria-hidden="true">
      <rect width="7" height="7" rx="1.6" fill={dim ? "var(--surface-2)" : `hsl(${hue} 45% 20%)`} />
      {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width="1" height="1" fill={fg} />)}
    </svg>
  );
}
