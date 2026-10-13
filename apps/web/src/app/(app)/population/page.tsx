import Link from "next/link";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { ApiPopulation } from "@/components/api/screens";
import { Icon } from "@/components/Icon";
import { Card, Kpi, SampleBadge, ScreenHead } from "@/components/ui";
import { USES_API } from "@/data/config";
import { outcomeShort } from "@/data/explain";
import { IS_SAMPLE_DATA, getSource } from "@/data/source";
import type { NepBreakdown } from "@/data/types";
import { usd } from "@/lib/format";
import { AgentTable, type Row } from "./_components/AgentTable";
import { NicheDiversity } from "./_components/NicheDiversity";
import { X402Split } from "./_components/X402Split";

const nepOf = (n: NepBreakdown) => n.realizedPnl - n.x402 - n.gas - n.fees - n.slippage;

export default async function PopulationPage() {
  if (USES_API) return <ApiPopulation />;
  const source = getSource();
  const [agents, owners, evaluations, range, spend] = await Promise.all([
    source.listAgents(),
    source.listOwners(),
    source.listEvaluations(),
    source.evaluationRange(),
    source.getX402Spend(),
  ]);
  const moves = (await source.listReallocations()).filter((m) => m.evaluation === range.last);
  const live = agents.filter((a) => a.status !== "retired");
  const nep = (await Promise.all(live.map((a) => source.getNep(a.id)))).reduce((s, n) => s + (n ? nepOf(n) : 0), 0);

  const capital = live.reduce((s, a) => s + a.capital, 0);
  const principal = live.reduce((s, a) => s + a.principal, 0);
  const overPrincipal = principal > 0 ? (capital / principal - 1) * 100 : 0;
  const retired = agents.length - live.length;
  const moved = moves.reduce((s, m) => s + m.amount, 0);
  const withPolicy = owners.filter((o) => o.policy).length;

  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const outcome = new Map(evaluations.map((v) => [v.agentId, v.outcome]));
  const rows: Row[] = agents.map((a) => {
    const o = outcome.get(a.id);
    return { agent: a, owner: ownerName.get(a.ownerId) ?? a.ownerId, last: o ? outcomeShort(o) : "", moved: o?.kind === "sent" || o?.kind === "received" };
  });

  return (
    <>
      <ScreenHead
        title="Population"
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
        Every agent across all owners. Fitness is a percentile within the agent&apos;s niche, adjusted for risk and for the amount of evidence, not raw
        profit. Capital only moves between agents of the same owner, and only under a policy that owner signed.
      </ScreenHead>

      <section aria-label="Population summary" className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
        <Kpi label="Reallocated" value={usd(moved)} detail={`${moves.length} ${moves.length === 1 ? "move" : "moves"} at evaluation ${range.last}, each within one owner`} />
        <Kpi
          label="Owners with a policy"
          value={
            <>
              {withPolicy}
              <span className="text-base text-muted"> / {owners.length}</span>
            </>
          }
          detail="Reallocation is off by default"
        />
      </section>

      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <AgentTable rows={rows} evaluations={range.last - range.first + 1} />
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
