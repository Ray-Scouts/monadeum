import Link from "next/link";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { Icon } from "@/components/Icon";
import { Card, Kpi, SampleBadge, ScreenHead } from "@/components/ui";
import { eligibilityChecks, isEligible } from "@/data/eligibility";
import { IS_SAMPLE_DATA, getSource } from "@/data/source";
import type { NepBreakdown } from "@/data/types";
import { usd } from "@/lib/format";
import { AgentTable } from "./_components/AgentTable";
import { NicheDiversity } from "./_components/NicheDiversity";
import { X402Split } from "./_components/X402Split";

const nepOf = (n: NepBreakdown) => n.realizedPnl - n.x402 - n.gas - n.fees - n.slippage;

export default async function PopulationPage() {
  const source = getSource();
  const [agents, spend] = await Promise.all([source.listAgents(), source.getX402Spend()]);
  const live = agents.filter((a) => a.status !== "retired");
  const nep = (await Promise.all(live.map((a) => source.getNep(a.id)))).reduce((s, n) => s + (n ? nepOf(n) : 0), 0);

  const capital = live.reduce((s, a) => s + a.capital, 0);
  const principal = live.reduce((s, a) => s + a.principal, 0);
  const overPrincipal = principal > 0 ? (capital / principal - 1) * 100 : 0;
  const eligible = live.filter((a) => isEligible(a, live.length)).length;
  const conditions = agents[0] ? eligibilityChecks(agents[0]).length : 0;
  const maxGeneration = Math.max(0, ...agents.map((a) => a.generation));
  const descendants = agents.filter((a) => a.generation > 0).length;
  const retired = agents.length - live.length;

  return (
    <>
      <ScreenHead
        title="Your population"
        aside={
          <div className="flex flex-wrap items-center gap-2.5">
            {IS_SAMPLE_DATA && <SampleBadge />}
            <Link href="/create" className="btn btn-primary">
              <Icon name="plus" />
              New agent
            </Link>
          </div>
        }
      >
        Each agent competes within its niche. Fitness is a percentile adjusted for risk and for the amount of evidence, not raw profit.
      </ScreenHead>

      <section aria-label="Population summary" className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi
          label="Live agents"
          value={
            <>
              {live.length}
              <span className="text-base text-muted"> / {PROTOCOL.testnetPopulationCap}</span>
            </>
          }
          detail={`${retired} retired, history kept`}
        />
        <Kpi
          label="Total capital"
          value={usd(capital)}
          detail={
            <>
              <b className={`font-medium ${overPrincipal >= 0 ? "text-good" : "text-bad"}`}>
                {overPrincipal >= 0 ? "+" : ""}
                {overPrincipal.toFixed(1)}%
              </b>{" "}
              over principal
            </>
          }
        />
        <Kpi label="Population NEP" value={`${nep >= 0 ? "+" : ""}${usd(nep)}`} detail="Current window: PnL minus x402, gas, fees and slippage" />
        <Kpi label="Eligible" value={eligible} detail={`Meet all ${conditions} conditions to reproduce`} />
        <Kpi label="Max generation" value={`G${maxGeneration}`} detail={`${descendants} descendants in total`} />
      </section>

      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <AgentTable agents={agents} populationSize={live.length} />
        </Card>
        <div className="flex min-w-0 flex-col gap-4">
          <NicheDiversity live={live} />
          <X402Split spend={spend} />
        </div>
      </div>
    </>
  );
}

export const metadata = { title: "Population" };
