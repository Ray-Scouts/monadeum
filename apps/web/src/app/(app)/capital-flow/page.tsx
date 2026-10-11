import Link from "next/link";
import { ApiCapitalFlow } from "@/components/api/screens";
import { SampleReallocationNote } from "@/components/SampleReallocationNote";
import { Card, CardHead, Identicon, Kpi, Pill, SampleBadge, ScreenHead } from "@/components/ui";
import { USES_API } from "@/data/config";
import { boundsFor } from "@/data/evaluate";
import { flowMatrix } from "@/data/flow";
import { IS_SAMPLE_DATA, getSource } from "@/data/source";
import { agentLabel, pct, usd } from "@/lib/format";

const signed = (v: number) => `${v > 0 ? "+" : "-"}${usd(Math.abs(v))}`;
const TH = "whitespace-nowrap border-b border-line-soft px-2.5 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.08em] text-faint uppercase";
const TD = "whitespace-nowrap border-b border-line-soft px-2.5 py-2.5 align-middle";

export default async function CapitalFlowPage({ searchParams }: { searchParams: Promise<{ owner?: string | string[] }> }) {
  if (USES_API) return <ApiCapitalFlow />;
  const source = getSource();
  const [owners, agents, allMoves, range, params] = await Promise.all([
    source.listOwners(),
    source.listAgents(),
    source.listReallocations(),
    source.evaluationRange(),
    searchParams,
  ]);
  const requested = typeof params.owner === "string" ? params.owner : undefined;
  const owner =
    owners.find((o) => o.id === requested) ?? owners.find((o) => o.policy && allMoves.some((m) => m.ownerId === o.id)) ?? owners[0];

  const head = (
    <ScreenHead title="Capital flow" aside={IS_SAMPLE_DATA ? <SampleBadge /> : undefined}>
      Capital moved between one owner&apos;s agents at each evaluation, and the agents that retired. Reallocation never crosses an owner boundary, so it
      never changes an owner&apos;s total. It creates no agents and copies no genome.
    </ScreenHead>
  );
  const note = <SampleReallocationNote />;
  if (!owner) return <>{head}{note}<p className="text-muted">No owners yet.</p></>;

  const mine = agents.filter((a) => a.ownerId === owner.id);
  const moves = allMoves.filter((m) => m.ownerId === owner.id);
  const rows = flowMatrix(mine, moves, range.first, range.last);
  const evals = Array.from({ length: range.last - range.first + 1 }, (_, i) => range.first + i);
  const moved = moves.reduce((s, m) => s + m.amount, 0);
  const netSum = rows.reduce((s, r) => s + r.total, 0);
  const total = mine.reduce((s, a) => s + a.capital, 0);
  const live = mine.filter((a) => a.status !== "retired").length;
  const b = boundsFor(owner);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const name = (id: string) => {
    const a = byId.get(id);
    return a ? agentLabel(a) : id;
  };

  return (
    <>
      {head}
      {note}

      <nav aria-label="Owner">
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {owners.map((o) => (
            <li key={o.id}>
              <Link
                href={`/capital-flow?owner=${o.id}`}
                aria-current={o.id === owner.id ? "page" : undefined}
                className="inline-flex items-center gap-2 rounded-full border border-line-soft bg-surface px-3.5 py-1.5 text-sm text-muted hover:text-fg aria-[current=page]:border-accent aria-[current=page]:bg-accent-wash aria-[current=page]:text-fg"
              >
                {o.name}
                <span className="font-mono text-xs text-faint">{agents.filter((a) => a.ownerId === o.id).length}</span>
                <span className="sr-only">agents{o.policy ? ", policy in force" : ", no policy"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-label={`Summary for ${owner.name}`} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Agents" value={live} detail={`${mine.length - live} retired, capital kept in their accounts`} />
        <Kpi label="Owner's total" value={usd(total)} detail="Across all of this owner's agents" />
        <Kpi label="Reallocated" value={usd(moved)} detail={`${moves.length} ${moves.length === 1 ? "move" : "moves"} over ${evals.length} evaluations`} />
        <Kpi
          label="Policy"
          value={owner.policy ? <Pill tone="accent">In force</Pill> : <Pill tone="off">None</Pill>}
          detail={owner.policy ? `Cap ${pct(b.cap)}, ceiling ${b.ceiling} times principal` : "Reallocation is off by default"}
        />
      </section>

      <Card>
        <CardHead title={`Moves by evaluation, ${owner.name}`}>
          <span className="text-[13px] text-muted">Positive is received, negative is sent</span>
        </CardHead>
        {!owner.policy && (
          <p className="mb-3 text-sm text-muted">
            {live <= 1 ? "This owner has one agent, so reallocation gives them no benefit." : "This owner has not signed a reallocation policy."} Nothing
            has moved between their agents.
          </p>
        )}
        <div className="relative -mx-5 overflow-x-auto px-5">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Capital moved into or out of each of {owner.name}&apos;s agents by reallocation, at evaluations {range.first} to {range.last}
            </caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Agent</th>
                {evals.map((e) => (
                  <th key={e} scope="col" className={`${TH} text-right`}>
                    <span className="sr-only">Evaluation </span>
                    {e}
                  </th>
                ))}
                <th scope="col" className={`${TH} text-right`}>Net</th>
                <th scope="col" className={`${TH} text-right`}>Capital now</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ agent: a, net, total: sum }) => (
                <tr key={a.id}>
                  <th scope="row" className={`${TD} text-left font-semibold`}>
                    <Link href={`/agents/${a.id}`} className="inline-flex items-center gap-2 hover:underline">
                      <Identicon agent={a} className="size-6 rounded-[7px]" />
                      {agentLabel(a)}
                    </Link>
                    {owner.policy && !owner.policy.agentIds.includes(a.id) && <span className="ml-2 text-xs font-normal text-muted">not in policy</span>}
                  </th>
                  {net.map((v, i) => {
                    const e = evals[i]!;
                    const retiredHere = a.retirement?.evaluation === e;
                    const gone = a.retirement && e > a.retirement.evaluation;
                    return (
                      <td key={e} className={`${TD} text-right font-mono tabular`}>
                        {retiredHere ? (
                          <Pill tone="off">Retired</Pill>
                        ) : v !== 0 ? (
                          <span className={`rounded-md px-1.5 py-0.5 ${v > 0 ? "bg-good-wash text-good" : "bg-warn-wash text-warn"}`}>{signed(v)}</span>
                        ) : (
                          <>
                            <span aria-hidden="true" className="text-faint">{gone ? "" : "·"}</span>
                            <span className="sr-only">{gone ? "retired" : "no move"}</span>
                          </>
                        )}
                      </td>
                    );
                  })}
                  <td className={`${TD} text-right font-mono tabular ${sum > 0 ? "text-good" : sum < 0 ? "text-warn" : "text-muted"}`}>
                    {sum === 0 ? usd(0) : signed(sum)}
                  </td>
                  <td className={`${TD} text-right font-mono tabular`}>
                    {usd(a.capital)}
                    {a.capital < a.principal && <small className="block text-[11px] text-muted">below its {usd(a.principal)} principal</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">
          The net column sums to {usd(Math.abs(netSum) < 0.005 ? 0 : netSum)}: every amount sent arrived at another of this owner&apos;s agents. Capital also
          changes through trading, so capital now is not principal plus net.
        </p>
      </Card>

      {moves.length > 0 && (
        <Card>
          <CardHead title="Every move" />
          <ol className="m-0 grid list-none gap-0 p-0">
            {[...moves].reverse().map((m) => (
              <li key={`${m.evaluation}-${m.sourceId}-${m.sinkId}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line-soft py-2.5 text-sm last:border-b-0">
                <span className="w-[110px] font-mono text-xs text-faint">Evaluation {m.evaluation}</span>
                <span className="min-w-0 flex-1">
                  <Link href={`/agents/${m.sourceId}`} className="font-semibold hover:underline">{name(m.sourceId)}</Link>
                  <span className="text-muted"> sent to </span>
                  <Link href={`/agents/${m.sinkId}`} className="font-semibold hover:underline">{name(m.sinkId)}</Link>
                </span>
                <span className="font-mono tabular">{usd(m.amount)}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}

export const metadata = { title: "Capital flow" };
