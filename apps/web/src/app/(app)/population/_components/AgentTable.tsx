"use client";

import Link from "next/link";
import { useState } from "react";
import { Segmented } from "@/components/Segmented";
import { Identicon, Sparkline, StatusPill } from "@/components/ui";
import { STARVATION_PERCENTILE } from "@/data/evaluate";
import type { Agent } from "@/data/types";
import { usd } from "@/lib/format";

type Filter = "all" | "moved" | "active" | "retired";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "moved", label: "Moved capital" },
  { value: "active", label: "Live" },
  { value: "retired", label: "Retired" },
];

/** Percentile 50 is the niche median by definition, so the mark sits at the middle of the bar. */
const MEDIAN_MARK = 50;

export interface Row {
  agent: Agent;
  owner: string;
  /** What happened to it at the last evaluation, in a few words. */
  last: string;
  /** It sent or received capital at the last evaluation. */
  moved: boolean;
}

function matches(filter: Filter, row: Row): boolean {
  if (filter === "moved") return row.moved;
  if (filter === "active") return row.agent.status !== "retired";
  if (filter === "retired") return row.agent.status === "retired";
  return true;
}

export function AgentTable({ rows: all, evaluations }: { rows: Row[]; evaluations: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = all
    .filter((r) => matches(filter, r))
    .sort(
      (x, y) =>
        Number(x.agent.status === "retired") - Number(y.agent.status === "retired") ||
        (y.agent.fitnessPercentile ?? -1) - (x.agent.fitnessPercentile ?? -1),
    );

  return (
    <>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Agents</h2>
        <Segmented label="Filter by status" options={FILTERS} value={filter} onChange={setFilter} />
      </div>
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Agents in the population, filtered by {FILTERS.find((f) => f.value === filter)!.label.toLowerCase()}</caption>
          <thead>
            <tr className="border-b border-line-soft text-left font-mono text-[11px] tracking-[0.08em] text-faint uppercase">
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">Agent</th>
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">Status</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Capital</th>
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">Last {evaluations} evaluations</th>
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">Fitness (percentile)</th>
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">Last evaluation</th>
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">Trades</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ agent: a, owner, last }) => {
              const retired = a.status === "retired";
              const sparkColor = retired ? "var(--faint)" : a.capital >= a.principal ? "var(--good)" : "var(--bad)";
              return (
                <tr key={a.id} className="relative border-b border-line-soft transition-colors hover:bg-surface-2 has-[a:focus-visible]:bg-surface-2">
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2.5">
                      <Identicon agent={a} />
                      <div>
                        {/* The link covers the whole row so any cell opens the agent, while the row keeps a single tab stop. */}
                        <Link
                          href={`/agents/${a.id}`}
                          className="font-semibold after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent-hi"
                        >
                          {a.name}
                          <span className="sr-only">, open agent {a.id}</span>
                        </Link>
                        <small className="block font-mono text-xs text-faint">
                          {a.id} · {owner}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <StatusPill agent={a} />
                  </td>
                  <td className="px-3 py-3 text-right font-mono whitespace-nowrap tabular">{usd(a.capital)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <Sparkline values={a.capitalHistory} color={sparkColor} />
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {a.fitnessPercentile === null ? (
                      <span className="text-xs text-muted">Not ranked yet</span>
                    ) : (
                      <div className="flex min-w-[120px] items-center gap-2" title="The center mark is the niche median">
                        <div className="relative h-1.5 flex-1 rounded-full bg-line-soft" aria-hidden="true">
                          <span
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{ width: `${a.fitnessPercentile}%`, background: a.fitnessPercentile < STARVATION_PERCENTILE ? "var(--bad)" : "var(--accent)" }}
                          />
                          <span className="absolute -inset-y-[3px] w-px bg-faint" style={{ left: `${MEDIAN_MARK}%` }} />
                        </div>
                        <span className="w-[26px] text-right font-mono tabular">{a.fitnessPercentile}</span>
                        {a.fitnessPercentile < STARVATION_PERCENTILE && <span className="sr-only">, in the bottom tenth of its niche</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap text-muted">{last}</td>
                  <td className="px-3 py-3 font-mono whitespace-nowrap tabular">{a.tradeCount}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-7 text-center text-muted">
                  No agents match this filter yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
