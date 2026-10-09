import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { Icon } from "@/components/Icon";
import { Kpi } from "@/components/ui";
import { eligibilityChecks } from "@/data/eligibility";
import { getSource, IS_SAMPLE_DATA } from "@/data/source";
import { agentLabel, usd } from "@/lib/format";
import { AgentHero } from "./_components/AgentHero";
import { nepOf, Overview } from "./_components/overview";
import { GenomePanel, PurchasesPanel, ReproductionPanel, TradesPanel } from "./_components/panels";
import { Tabs } from "./_components/Tabs";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const agent = await getSource().getAgent(id);
  return { title: agent ? `${agentLabel(agent)}` : "Agent not found" };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const source = getSource();
  const agent = await source.getAgent(id);
  if (!agent) notFound();

  const [agents, parent, trades, purchases, nep] = await Promise.all([
    source.listAgents(),
    agent.parentId ? source.getAgent(agent.parentId) : Promise.resolve(null),
    source.listTrades(agent.id),
    source.listPurchases(agent.id),
    source.getNep(agent.id),
  ]);
  const populationSize = agents.filter((a) => a.status !== "retired").length;
  const checks = eligibilityChecks(agent);
  const okN = checks.filter((c) => c.ok).length;
  const windowNep = nep ? nepOf(nep) : null;
  const short = PROTOCOL.nMin - agent.tradeCount;

  return (
    <>
      <Link href="/population" className="btn btn-ghost self-start pl-2">
        <Icon name="back" />
        Population
      </Link>

      <AgentHero agent={agent} parent={parent ? { id: parent.id, name: parent.name } : null} populationSize={populationSize} sample={IS_SAMPLE_DATA} />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Capital" value={usd(agent.capital)} detail={`Principal ${usd(agent.principal)}`} />
        <Kpi
          label="Window NEP"
          value={windowNep === null ? "n/a" : <span className={windowNep >= 0 ? "text-good" : "text-bad"}>{usd(windowNep)}</span>}
          detail="After all costs"
        />
        <Kpi label="Fitness" value={`P${agent.fitnessPercentile}`} detail="Percentile in its niche" />
        <Kpi label="Trades" value={agent.tradeCount} detail={short <= 0 ? `Minimum of ${PROTOCOL.nMin} met` : `${short} short of ${PROTOCOL.nMin}`} />
        <Kpi label="Eligibility" value={`${okN}/${checks.length}`} detail={okN === checks.length ? "Can reproduce" : "Conditions met"} />
      </section>

      <Tabs
        label={`Details for ${agentLabel(agent)}`}
        tabs={[
          { id: "overview", label: "Overview", content: <Overview agent={agent} nep={nep} /> },
          { id: "genome", label: "Genome", content: <GenomePanel agent={agent} /> },
          { id: "trades", label: "Trades", content: <TradesPanel trades={trades} /> },
          { id: "x402", label: "x402 purchases", content: <PurchasesPanel purchases={purchases} /> },
          { id: "reproduction", label: "Reproduction", content: <ReproductionPanel agent={agent} checks={checks} /> },
        ]}
      />
    </>
  );
}
