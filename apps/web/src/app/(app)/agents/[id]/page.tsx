import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiAgent } from "@/components/api/screens";
import { Icon } from "@/components/Icon";
import { Kpi } from "@/components/ui";
import { USES_API } from "@/data/config";
import { outcomeShort, type Counterpart } from "@/data/explain";
import { getSource, IS_SAMPLE_DATA } from "@/data/source";
import { agentLabel, usd } from "@/lib/format";
import { AgentHero } from "./_components/AgentHero";
import { nepOf, Overview } from "./_components/overview";
import { GenomePanel, PurchasesPanel, TradesPanel } from "./_components/panels";
import { ReallocationPanel } from "./_components/reallocation";
import { Tabs } from "./_components/Tabs";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  // In api mode the agent is read in the browser with the user's credential, so the server cannot name it.
  if (USES_API) return { title: "Agent" };
  const agent = await getSource().getAgent(id);
  return { title: agent ? `${agentLabel(agent)}` : "Agent not found" };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  if (USES_API) return <ApiAgent id={id} />;
  const source = getSource();
  const agent = await source.getAgent(id);
  if (!agent) notFound();

  const [agents, owner, evaluation, moves, trades, purchases, nep] = await Promise.all([
    source.listAgents(),
    source.getOwner(agent.ownerId),
    source.getEvaluation(agent.id),
    source.listReallocations(agent.ownerId),
    source.listTrades(agent.id),
    source.listPurchases(agent.id),
    source.getNep(agent.id),
  ]);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const counterparts: Counterpart[] = moves
    .filter((m) => m.evaluation === evaluation?.evaluation && (m.sourceId === agent.id || m.sinkId === agent.id))
    .map((m) => {
      const other = byId.get(m.sourceId === agent.id ? m.sinkId : m.sourceId);
      return { label: other ? agentLabel(other) : "another agent", amount: m.amount };
    });
  const windowNep = nep ? nepOf(nep) : null;

  return (
    <>
      <Link href="/population" className="btn btn-ghost self-start pl-2">
        <Icon name="back" />
        Population
      </Link>

      <AgentHero agent={agent} owner={owner ? { id: owner.id, name: owner.name } : null} sample={IS_SAMPLE_DATA} />

      <section aria-label="Key figures" className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Capital" value={usd(agent.capital)} detail={`Principal ${usd(agent.principal)}`} />
        <Kpi
          label="Window NEP"
          value={windowNep === null ? "n/a" : <span className={windowNep >= 0 ? "text-good" : "text-bad"}>{usd(windowNep)}</span>}
          detail="After all costs"
        />
        <Kpi
          label="Fitness"
          value={agent.fitnessPercentile === null ? "n/a" : `P${agent.fitnessPercentile}`}
          detail={agent.fitnessPercentile === null ? "No adjusted fitness yet" : "Percentile in its niche"}
        />
        <Kpi label="Trades" value={agent.tradeCount} detail="In the current window" />
        <Kpi
          label="Last evaluation"
          value={<span className="text-[19px]">{evaluation ? outcomeShort(evaluation.outcome) : "n/a"}</span>}
          detail={evaluation ? `Evaluation ${evaluation.evaluation}` : "None yet"}
        />
      </section>

      <Tabs
        label={`Details for ${agentLabel(agent)}`}
        tabs={[
          { id: "overview", label: "Overview", content: <Overview agent={agent} nep={nep} /> },
          {
            id: "reallocation",
            label: "Reallocation and retirement",
            content: <ReallocationPanel agent={agent} evaluation={evaluation} owner={owner} counterparts={counterparts} />,
          },
          { id: "genome", label: "Genome", content: <GenomePanel agent={agent} /> },
          { id: "trades", label: "Trades", content: <TradesPanel trades={trades} /> },
          { id: "x402", label: "x402 purchases", content: <PurchasesPanel purchases={purchases} /> },
        ]}
      />
    </>
  );
}
