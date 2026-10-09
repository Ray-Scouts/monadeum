import { SampleBadge, ScreenHead } from "@/components/ui";
import { isEligible } from "@/data/eligibility";
import { IS_SAMPLE_DATA, getSource } from "@/data/source";
import { LineageExplorer } from "./_components/LineageExplorer";
import { layoutTree } from "./_components/layout";

const LEGEND = [
  { label: "Active", color: "var(--accent)" },
  { label: "Eligible", color: "var(--good)" },
  { label: "In review", color: "var(--warn)" },
  { label: "Paused", color: "var(--muted)" },
  { label: "Retired", color: "var(--faint)" },
];

export default async function LineagePage({ searchParams }: { searchParams: Promise<{ agent?: string | string[] }> }) {
  const source = getSource();
  const [agents, reproductions, params] = await Promise.all([source.listAgents(), source.listReproductions(), searchParams]);
  const populationSize = agents.filter((a) => a.status !== "retired").length;
  const requested = typeof params.agent === "string" ? params.agent : undefined;
  const initial =
    agents.find((a) => a.id === requested) ??
    agents.find((a) => a.generation === 1 && isEligible(a, populationSize)) ??
    agents[0];

  return (
    <>
      <ScreenHead
        title="Lineage tree"
        aside={
          <div className="flex flex-col items-start gap-2.5 sm:items-end">
            {IS_SAMPLE_DATA && <SampleBadge />}
            <ul aria-label="Legend" className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-muted">
              {LEGEND.map((l) => (
                <li key={l.label} className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full" style={{ background: l.color }} aria-hidden="true" />
                  {l.label}
                </li>
              ))}
              <li>Size = capital</li>
            </ul>
          </div>
        }
      >
        Each branch is a reproduction event recorded on-chain: parent, child, generation, genome hash and capital transferred. Only profit is shared, never
        the parent&apos;s principal.
      </ScreenHead>

      {initial ? (
        <LineageExplorer
          agents={agents}
          reproductions={reproductions}
          layout={layoutTree(agents)}
          populationSize={populationSize}
          initialId={initial.id}
          sampleData={IS_SAMPLE_DATA}
        />
      ) : (
        <p className="text-muted">No agents yet. Create one to start a lineage.</p>
      )}
    </>
  );
}

export const metadata = { title: "Lineage" };
