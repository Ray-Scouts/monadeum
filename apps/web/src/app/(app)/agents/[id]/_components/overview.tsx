import { shrinkageWeight, SHRINKAGE_K } from "@monadeum/fitness/math";
import { Card, CardHead, Tag } from "@/components/ui";
import type { Agent, NepBreakdown } from "@/data/types";
import { agentLabel, usd } from "@/lib/format";

/** Window NEP: realized PnL net of every cost, per EVOLUTION.md section 2.1. */
export const nepOf = (n: NepBreakdown) => n.realizedPnl - n.x402 - n.gas - n.fees - n.slippage;

function CapitalChart({ agent }: { agent: Agent }) {
  const W = 480, H = 220, p = { l: 50, r: 12, t: 12, b: 28 };
  const v = agent.capitalHistory.length > 1 ? agent.capitalHistory : [agent.capital, agent.capital];
  const mn = Math.min(...v, agent.principal) * 0.92;
  const mx = Math.max(...v, agent.principal) * 1.05;
  const x = (i: number) => p.l + (i / (v.length - 1)) * (W - p.l - p.r);
  const y = (val: number) => p.t + (1 - (val - mn) / (mx - mn || 1)) * (H - p.t - p.b);
  const d = v.map((val, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join("");
  const last = v[v.length - 1] ?? agent.capital;
  const grad = `cap-grad-${agent.id}`;
  const textCls = "fill-faint font-mono text-[12px]";
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full"
      role="img"
      aria-label={`Capital of ${agentLabel(agent)} after each of the last ${v.length - 1} evaluations, now ${usd(agent.capital)}. Principal ${usd(agent.principal)}.`}
    >
      <defs>
        <linearGradient id={grad} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity={0.35} />
          <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {[mn, (mn + mx) / 2, mx].map((t) => (
        <g key={t}>
          <line x1={p.l} x2={W - p.r} y1={y(t)} y2={y(t)} stroke="var(--line-soft)" />
          <text x={p.l - 8} y={y(t) + 4} textAnchor="end" className={textCls}>
            ${t.toFixed(1)}
          </text>
        </g>
      ))}
      <line x1={p.l} x2={W - p.r} y1={y(agent.principal)} y2={y(agent.principal)} stroke="var(--muted)" strokeDasharray="4 4" />
      <path d={`${d}L${x(v.length - 1)},${H - p.b}L${p.l},${H - p.b}Z`} fill={`url(#${grad})`} />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2.2} />
      <circle cx={x(v.length - 1)} cy={y(last)} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
      <text x={p.l} y={H - 6} className={textCls}>
        {v.length - 1} evaluations ago
      </text>
      <text x={W - p.r} y={H - 6} textAnchor="end" className={textCls}>
        now
      </text>
    </svg>
  );
}

function Legend() {
  const items = [
    ["Capital", "bg-accent"],
    ["Principal", "bg-muted"],
  ] as const;
  return (
    <ul className="flex flex-wrap gap-3.5 text-xs text-muted" aria-label="Chart legend">
      {items.map(([k, c]) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <span className={`size-2.5 rounded-full ${c}`} aria-hidden="true" />
          {k}
        </li>
      ))}
    </ul>
  );
}

function Waterfall({ nep }: { nep: NepBreakdown }) {
  const rows = [
    { k: "Realized PnL", v: nep.realizedPnl, c: nep.realizedPnl >= 0 ? "bg-good" : "bg-bad" },
    { k: "x402", v: -nep.x402, c: "bg-berry" },
    { k: "Gas", v: -nep.gas, c: "bg-muted" },
    { k: "Fees", v: -nep.fees, c: "bg-muted" },
    { k: "Slippage", v: -nep.slippage, c: "bg-muted" },
  ];
  // the scale spans every running total, so a negative NEP still draws inside the track
  let run = 0;
  const points = [0, ...rows.map((r) => (run += r.v))];
  const lo = Math.min(...points), hi = Math.max(...points), span = hi - lo || 1;
  const pos = (val: number) => ((val - lo) / span) * 100;
  const total = nepOf(nep);
  run = 0;
  const signed = (val: number) => `${val >= 0 ? "+" : ""}${usd(val)}`;
  const row = "grid grid-cols-[88px_minmax(0,1fr)_64px] items-center gap-3 text-[13px] sm:grid-cols-[120px_minmax(0,1fr)_72px]";
  return (
    <div className="grid gap-2.5">
      {rows.map((r) => {
        const start = run;
        run += r.v;
        const left = pos(Math.min(start, run));
        return (
          <div key={r.k} className={row}>
            <span className="text-muted">{r.k}</span>
            <div className="relative h-[22px] rounded-md bg-surface-2" aria-hidden="true">
              <span className={`absolute inset-y-0 rounded-md ${r.c}`} style={{ left: `${left}%`, width: `${Math.max(1, pos(Math.max(start, run)) - left)}%` }} />
            </div>
            <span className="text-right font-mono tabular">{signed(r.v)}</span>
          </div>
        );
      })}
      <div className={`${row} border-t border-line pt-2.5 font-semibold`}>
        <span>NEP</span>
        <div className="relative h-[22px] rounded-md bg-surface-2" aria-hidden="true">
          <span
            className={`absolute inset-y-0 rounded-md ${total >= 0 ? "bg-accent" : "bg-bad"}`}
            style={{ left: `${pos(Math.min(0, total))}%`, width: `${Math.max(1, Math.abs(pos(total) - pos(0)))}%` }}
          />
        </div>
        <span className={`text-right font-mono tabular ${total >= 0 ? "text-good" : "text-bad"}`}>{usd(total)}</span>
      </div>
    </div>
  );
}

function TrustRing({ weight }: { weight: number }) {
  const c = 2 * Math.PI * 22;
  return (
    <svg viewBox="0 0 56 56" className="size-14 flex-none" aria-hidden="true">
      <circle cx="28" cy="28" r="22" fill="none" stroke="var(--line)" strokeWidth={6} />
      <circle cx="28" cy="28" r="22" fill="none" stroke="var(--accent)" strokeWidth={6} strokeLinecap="round" strokeDasharray={`${c * weight} ${c}`} transform="rotate(-90 28 28)" />
    </svg>
  );
}

export function Overview({ agent, nep }: { agent: Agent; nep: NepBreakdown | null }) {
  const w = shrinkageWeight(agent.tradeCount);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHead title="Capital over time">
          <Legend />
        </CardHead>
        <CapitalChart agent={agent} />
      </Card>
      <Card>
        <CardHead title="Net economic performance">
          <Tag>NEP</Tag>
        </CardHead>
        {nep ? <Waterfall nep={nep} /> : <p className="text-sm text-muted">No completed window yet.</p>}
        <div className="mt-3.5 flex items-center gap-3.5 rounded-xl bg-accent-wash p-3.5">
          <TrustRing weight={w} />
          <div>
            <b>Trust in its own record: {Math.round(w * 100)}%</b>
            <p className="text-[13px] text-muted">
              With {agent.tradeCount} trades, its fitness is weighted {agent.tradeCount} / ({agent.tradeCount} + {SHRINKAGE_K}) toward its own record and the rest
              toward the population median, so lucky streaks are not rewarded.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
