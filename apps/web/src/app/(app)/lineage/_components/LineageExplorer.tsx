"use client";

import Link from "next/link";
import { useState, type KeyboardEvent } from "react";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { Icon } from "@/components/Icon";
import { Card, Identicon, StatusPill } from "@/components/ui";
import { isEligible } from "@/data/eligibility";
import type { Agent, Genome, Reproduction } from "@/data/types";
import { agentLabel, usd } from "@/lib/format";
import type { TreeLayout } from "./layout";

const FIELD_LABEL: Partial<Record<keyof Genome, string>> = {
  riskTolerance: "risk tolerance",
  executionFrequency: "tick interval",
  timeHorizon: "time horizon",
  assetUniverse: "asset universe",
  informationBudget: "information budget",
  modelConfiguration: "model configuration",
};

function nodeColor(agent: Agent, populationSize: number): string {
  if (agent.status === "retired") return "var(--faint)";
  if (agent.status === "review") return "var(--warn)";
  if (agent.status === "paused") return "var(--muted)";
  if (isEligible(agent, populationSize)) return "var(--good)";
  return "var(--accent)";
}

export function LineageExplorer({
  agents,
  reproductions,
  layout,
  populationSize,
  initialId,
  sampleData,
}: {
  agents: Agent[];
  reproductions: Reproduction[];
  layout: TreeLayout;
  populationSize: number;
  initialId: string;
  sampleData: boolean;
}) {
  const [selectedId, setSelectedId] = useState(initialId);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const maxCap = Math.max(0.01, ...agents.map((a) => a.capital));
  const selected = byId.get(selectedId) ?? agents[0];

  const onKey = (id: string) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelectedId(id);
    }
  };

  return (
    <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 overflow-x-auto rounded-card border border-line-soft bg-surface">
        <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label="Agent family tree" className="block">
          {layout.columns.map((x, g) => (
            <g key={g} aria-hidden="true">
              <text x={x} y={24} textAnchor="middle" className="fill-faint font-mono text-[11px] font-medium tracking-[0.1em]">
                GEN {g}
              </text>
              <line x1={x} y1={34} x2={x} y2={layout.height - 6} stroke="var(--line-soft)" strokeDasharray="2 6" />
            </g>
          ))}
          <g aria-hidden="true">
            {agents.map((a) => {
              const p = a.parentId ? layout.pos[a.parentId] : undefined;
              const c = layout.pos[a.id];
              if (!p || !c) return null;
              const mx = (p.x + c.x) / 2;
              return (
                <path
                  key={a.id}
                  d={`M${p.x},${p.y} C${mx},${p.y} ${mx},${c.y} ${c.x},${c.y}`}
                  fill="none"
                  stroke={a.status === "retired" ? "var(--line)" : "var(--accent)"}
                  strokeOpacity={0.55}
                  strokeWidth={1.6}
                />
              );
            })}
          </g>
          {agents.map((a) => {
            const p = layout.pos[a.id];
            if (!p) return null;
            const r = 6 + (a.capital / maxCap) * 10;
            const color = nodeColor(a, populationSize);
            const isSel = a.id === selected?.id;
            return (
              <g
                key={a.id}
                tabIndex={0}
                role="button"
                aria-pressed={isSel}
                aria-label={`${agentLabel(a)}, generation ${a.generation}, capital ${usd(a.capital)}`}
                onClick={() => setSelectedId(a.id)}
                onKeyDown={onKey(a.id)}
                className="group cursor-pointer outline-none"
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r + 6}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeOpacity={0.5}
                  className={`transition-opacity ${isSel ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r + 10}
                  fill="none"
                  stroke="var(--accent-hi)"
                  strokeWidth={2}
                  className="opacity-0 group-focus-visible:opacity-100"
                />
                <circle cx={p.x} cy={p.y} r={r} fill={color} fillOpacity={a.status === "retired" ? 0.35 : 1} />
                <text x={p.x + r + 8} y={p.y + 4} className={`font-mono text-xs ${isSel ? "fill-fg" : "fill-muted"}`}>
                  {a.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {selected && (
        <SidePanel
          agent={selected}
          parent={selected.parentId ? byId.get(selected.parentId) : undefined}
          birth={reproductions.find((r) => r.childId === selected.id)}
          populationSize={populationSize}
          sampleData={sampleData}
          onSelect={setSelectedId}
        />
      )}
    </div>
  );
}

function SidePanel({
  agent,
  parent,
  birth,
  populationSize,
  sampleData,
  onSelect,
}: {
  agent: Agent;
  parent: Agent | undefined;
  birth: Reproduction | undefined;
  populationSize: number;
  sampleData: boolean;
  onSelect: (id: string) => void;
}) {
  const changed = (field: keyof Genome, before: unknown, after: unknown) => (birth ? birth.mutated.includes(field) : before !== after);
  const otherMutations = (birth?.mutated ?? []).filter((f) => f !== "riskTolerance" && f !== "executionFrequency");

  return (
    <aside aria-label="Selected agent" className="flex min-w-0 flex-col gap-3">
      <p className="sr-only" aria-live="polite">
        Selected {agentLabel(agent)}
      </p>
      <Card className="flex flex-col gap-3.5">
        <div className="flex items-center gap-3">
          <Identicon agent={agent} className="size-10 rounded-xl" />
          <div className="min-w-0">
            <h2 className="truncate font-display text-xl font-bold">{agentLabel(agent)}</h2>
            <div className="mt-0.5">
              <StatusPill agent={agent} populationSize={populationSize} />
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
          <dt className="text-muted">Generation</dt>
          <dd className="text-right font-mono">G{agent.generation}</dd>
          <dt className="text-muted">Parent</dt>
          <dd className="text-right font-mono">
            {parent ? (
              <button type="button" onClick={() => onSelect(parent.id)} className="text-accent-hi underline-offset-2 hover:underline">
                {agentLabel(parent)}
                <span className="sr-only">, select parent in tree</span>
              </button>
            ) : (
              "Founder"
            )}
          </dd>
          <dt className="text-muted">Children</dt>
          <dd className="text-right font-mono tabular">
            {agent.childIds.length} / {PROTOCOL.maxDescendants}
          </dd>
          <dt className="text-muted">Capital</dt>
          <dd className="text-right font-mono tabular">{usd(agent.capital)}</dd>
          <dt className="text-muted">Principal</dt>
          <dd className="text-right font-mono tabular">{usd(agent.principal)}</dd>
          <dt className="text-muted">Genome hash</dt>
          <dd className="truncate text-right font-mono">{agent.genome.hash}</dd>
        </dl>
        <Link href={`/agents/${agent.id}`} className="btn btn-primary">
          Open agent
          <Icon name="arrow" />
        </Link>
      </Card>

      {parent ? (
        <Card>
          <span className="eyebrow">What changed at birth</span>
          <div className="mt-3 grid gap-2 text-sm">
            <DiffRow
              label="Risk tolerance"
              before={parent.genome.riskTolerance.toFixed(3)}
              after={agent.genome.riskTolerance.toFixed(3)}
              changed={changed("riskTolerance", parent.genome.riskTolerance, agent.genome.riskTolerance)}
            />
            <DiffRow
              label="Tick interval"
              before={String(parent.genome.executionFrequency)}
              after={String(agent.genome.executionFrequency)}
              changed={changed("executionFrequency", parent.genome.executionFrequency, agent.genome.executionFrequency)}
            />
            {otherMutations.length > 0 && (
              <p className="text-[13px] text-muted">Also mutated: {otherMutations.map((f) => FIELD_LABEL[f] ?? f).join(", ")}.</p>
            )}
            {birth && (
              <p className="text-[13px] text-muted">
                Received {usd(birth.childCapital)} of its parent&apos;s profit. The parent kept {usd(birth.parentCapitalAfter)}.
              </p>
            )}
            <p className="text-xs text-muted">
              Under the protocol defaults, each field mutates with {Math.round(PROTOCOL.pMut * 100)}% probability, by up to plus or minus{" "}
              {Math.round(PROTOCOL.mutBand * 100)}% of its value, clipped to protocol limits.
              {sampleData && " The sample data raises the probability so the lineage visibly differs."}
            </p>
          </div>
        </Card>
      ) : (
        <Card>
          <span className="eyebrow">Founder</span>
          <p className="mt-2 text-sm text-muted">
            Created directly by its owner with {usd(agent.principal)} of principal. Select a child to see what mutated.
          </p>
        </Card>
      )}
    </aside>
  );
}

function DiffRow({ label, before, after, changed }: { label: string; before: string; after: string; changed: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="inline-flex items-center gap-1.5 font-mono tabular">
        {before}
        <Icon name="arrow" className="size-3.5 text-faint" />
        <span className="sr-only">to</span>
        <b className={changed ? "text-accent-hi" : "font-normal text-muted"}>{after}</b>
        {!changed && <span className="sr-only">, unchanged</span>}
      </span>
    </div>
  );
}
