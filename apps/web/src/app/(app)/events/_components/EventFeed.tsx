"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { Segmented } from "@/components/Segmented";
import type { EventKind, EvolutionEvent } from "@/data/types";

type Filter = "all" | "reproduction" | "policy" | "x402" | "retirement";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "reproduction", label: "Reproduction" },
  { value: "policy", label: "Policy" },
  { value: "x402", label: "x402" },
  { value: "retirement", label: "Retirements" },
];

/** Breaker checks are policy-level events, so they show under Policy. */
const FILTER_OF: Record<EventKind, Filter> = {
  reproduction: "reproduction",
  policy: "policy",
  breaker: "policy",
  x402: "x402",
  retirement: "retirement",
};

const KIND: Record<EventKind, { icon: IconName; tile: string; name: string }> = {
  reproduction: { icon: "split", tile: "bg-accent-wash text-accent-hi", name: "Reproduction" },
  policy: { icon: "x", tile: "bg-bad-wash text-bad", name: "Policy" },
  breaker: { icon: "eye", tile: "bg-warn-wash text-warn", name: "Circuit breaker" },
  x402: { icon: "coin", tile: "bg-berry-wash text-berry", name: "x402" },
  retirement: { icon: "stop", tile: "bg-surface-2 text-muted", name: "Retirement" },
};

const ago = (m: number) => (m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`);

export function EventFeed({ events, labels, heading }: { events: EvolutionEvent[]; labels: Record<string, string>; heading: ReactNode }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = filter === "all" ? events : events.filter((e) => FILTER_OF[e.kind] === filter);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        {heading}
        <Segmented label="Filter events" options={FILTERS} value={filter} onChange={setFilter} />
      </div>
      <p role="status" className="sr-only">
        Showing {shown.length} {shown.length === 1 ? "event" : "events"}
      </p>
      <div className="min-w-0 rounded-card border border-line-soft bg-surface px-5 py-1">
        {shown.length === 0 ? (
          <p className="py-6 text-sm text-muted">No events of this kind yet.</p>
        ) : (
          <ul className="m-0 grid list-none p-0">
            {shown.map((e) => {
              const k = KIND[e.kind];
              const linked = e.agentIds.filter((id) => labels[id]);
              return (
                <li key={e.id} className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3.5 gap-y-1 border-b border-line-soft px-1 py-4 last:border-b-0 sm:grid-cols-[40px_minmax(0,1fr)_auto]">
                  <span className={`row-span-2 grid size-10 place-items-center rounded-xl sm:row-span-1 ${k.tile}`}>
                    <Icon name={k.icon} />
                    <span className="sr-only">{k.name}</span>
                  </span>
                  <div className="min-w-0">
                    <b className="font-semibold break-words">{e.title}</b>
                    <p className="mt-0.5 text-sm text-muted">{e.body}</p>
                    {e.tags.length > 0 && (
                      <ul aria-label="Tags" className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
                        {e.tags.map((t) => (
                          <li key={t} className="inline-block max-w-full rounded-md border border-line-soft bg-surface-2 px-2 py-0.5 font-mono text-xs break-all text-muted">
                            {t}
                          </li>
                        ))}
                      </ul>
                    )}
                    {linked.length > 0 && (
                      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
                        {linked.map((id) => (
                          <Link key={id} href={`/agents/${id}`} className="inline-flex items-center gap-1 font-semibold text-accent-hi hover:underline">
                            {labels[id]}
                            <Icon name="arrow" className="size-3.5" />
                          </Link>
                        ))}
                      </p>
                    )}
                  </div>
                  <time dateTime={`PT${e.minutesAgo}M`} className="col-start-2 font-mono text-xs whitespace-nowrap text-faint sm:col-start-3 sm:row-start-1">
                    {ago(e.minutesAgo)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
