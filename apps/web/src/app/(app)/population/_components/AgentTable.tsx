"use client";

import Link from "next/link";
import { useState } from "react";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { Segmented } from "@/components/Segmented";
import { Identicon, Sparkline, StatusPill } from "@/components/ui";
import { isEligible } from "@/data/eligibility";
import type { Agent } from "@/data/types";
import { usd } from "@/lib/format";

type Filter = "all" | "eligible" | "active" | "retired";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "eligible", label: "Eligible" },
  { value: "active", label: "Active" },
  { value: "retired", label: "Retired" },
];

/** Percentile 50 is the niche median by definition, so the mark sits at the middle of the bar. */
const MEDIAN_MARK = 50;
const PERCENTILE_FLOOR = PROTOCOL.pThreshold * 100;

function matches(filter: Filter, agent: Agent, populationSize: number): boolean {
  if (filter === "eligible") return isEligible(agent, populationSize);
  if (filter === "active") return agent.status !== "retired";
  if (filter === "retired") return agent.status === "retired";
  return true;
}

export function AgentTable({ agents, populationSize }: { agents: Agent[]; populationSize: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = agents
    .filter((a) => matches(filter, a, populationSize))
    .sort((a, b) => Number(a.status === "retired") - Number(b.status === "retired") || b.fitnessPercentile - a.fitnessPercentile);

  return (
    <>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Agents</h2>
        <Segmented label="Filter by status" options={FILTERS} value={filter} onChange={setFilter} />
      </div>
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Agents in your population, filtered by {FILTERS.find((f) => f.value === filter)!.label.toLowerCase()}</caption>
          <thead>
            <tr className="border-b border-line-soft text-left font-mono text-[11px] tracking-[0.08em] text-faint uppercase">
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">Agent</th>
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">Status</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Capital</th>
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">Last 30 ticks</th>
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">Fitness (percentile)</th>
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">Trades</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const retired = a.status === "retired";
              const sparkColor = retired ? "var(--faint)" : a.capital >= a.principal ? "var(--good)" : "var(--bad)";
              const tradesOk = a.tradeCount >= PROTOCOL.nMin;
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
                          {a.id} · G{a.generation}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <StatusPill agent={a} populationSize={populationSize} />
                  </td>
                  <td className="px-3 py-3 text-right font-mono whitespace-nowrap tabular">{usd(a.capital)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <Sparkline values={a.capitalHistory} color={sparkColor} />
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="flex min-w-[120px] items-center gap-2" title="The center mark is the niche median">
                      <div className="relative h-1.5 flex-1 rounded-full bg-line-soft" aria-hidden="true">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${a.fitnessPercentile}%`, background: a.fitnessPercentile >= PERCENTILE_FLOOR ? "var(--accent)" : "var(--faint)" }}
                        />
                        <span className="absolute -inset-y-[3px] w-px bg-faint" style={{ left: `${MEDIAN_MARK}%` }} />
                      </div>
                      <span className="w-[26px] text-right font-mono tabular">{a.fitnessPercentile}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono whitespace-nowrap tabular">
                    {a.tradeCount}
                    <span
                      className="ml-2 inline-block h-1 w-10 overflow-hidden rounded-full bg-line-soft align-middle"
                      title={`Minimum ${PROTOCOL.nMin} to reproduce`}
                      aria-hidden="true"
                    >
                      <span className={`block h-full ${tradesOk ? "bg-good" : "bg-muted"}`} style={{ width: `${Math.min(100, (a.tradeCount / PROTOCOL.nMin) * 100)}%` }} />
                    </span>
                    <span className="sr-only">{tradesOk ? `, meets the minimum of ${PROTOCOL.nMin}` : `, below the minimum of ${PROTOCOL.nMin}`}</span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-7 text-center text-muted">
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
