import { allocateCapital } from "@monadeum/reproduction/allocate";
import { PROTOCOL } from "monadeum-simulation/protocol";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Card, CardHead, Pill, Tag } from "@/components/ui";
import type { EligibilityCheck } from "@/data/eligibility";
import type { Agent, Provider, Trade, X402Purchase } from "@/data/types";
import { usd } from "@/lib/format";

const TH = "whitespace-nowrap border-b border-line-soft px-3 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.08em] text-faint uppercase";
const TD = "whitespace-nowrap border-b border-line-soft px-3 py-3 align-middle";
const R = "text-right";

function Table({ caption, head, children }: { caption: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const Note = ({ children }: { children: ReactNode }) => <p className="mt-3 text-xs text-muted">{children}</p>;

/** Placeholder glyph for a value that does not exist, with a spoken equivalent. */
const None = ({ spoken }: { spoken: string }) => (
  <>
    <span aria-hidden="true" className="text-faint">·</span>
    <span className="sr-only">{spoken}</span>
  </>
);

/* ---------- Genome ---------- */

type GenomeClass = "immutable" | "mutable" | "capped";
const CLASS_CHIP: Record<GenomeClass, [string, string]> = {
  immutable: ["Immutable", "border border-line bg-surface-2 text-muted"],
  mutable: ["Mutable", "bg-accent-wash text-accent-hi"],
  capped: ["Capped mutable", "bg-berry-wash text-berry"],
};

export function GenomePanel({ agent }: { agent: Agent }) {
  const g = agent.genome;
  const rows: { field: string; value: ReactNode; cls: GenomeClass; limit: string }[] = [
    { field: "Strategy", value: "Trading", cls: "immutable", limit: "Only one strategy plugin in the MVP" },
    {
      field: "Asset universe",
      value: <span className="flex flex-wrap gap-1.5">{g.assetUniverse.map((p) => <Tag key={p}>{p}</Tag>)}</span>,
      cls: "mutable",
      limit: "Subset of the platform allowlist",
    },
    { field: "Risk tolerance", value: g.riskTolerance.toFixed(3), cls: "capped", limit: `${PROTOCOL.riskFloor} to ${PROTOCOL.riskCeiling} of capital` },
    { field: "Tick interval", value: `${g.executionFrequency} ticks`, cls: "capped", limit: `${PROTOCOL.frequencyMin} to ${PROTOCOL.frequencyMax} ticks` },
    {
      field: "Signal horizon",
      value: `${g.timeHorizon} ticks`,
      cls: "mutable",
      limit: `Validated by the strategy plugin. The simulation clips it to ${PROTOCOL.timeHorizonMin} to ${PROTOCOL.timeHorizonMax} ticks`,
    },
    {
      field: "Information budget",
      value: `${usd(g.informationBudget)} / tick`,
      cls: "capped",
      limit: `Protocol daily spend ceiling. The simulation clips it at ${PROTOCOL.informationBudgetCeiling} per tick`,
    },
    { field: "Model configuration", value: g.modelConfiguration, cls: "capped", limit: `Allowed set: ${PROTOCOL.allowedModels.join(", ")}` },
  ];
  return (
    <Card>
      <CardHead title="Genome">
        <span className="font-mono text-[13px] text-muted">hash {g.hash}</span>
      </CardHead>
      <Table caption="Genome fields, their class and protocol limit" head={<><th className={TH}>Field</th><th className={TH}>Value</th><th className={TH}>Class</th><th className={TH}>Protocol limit</th></>}>
        {rows.map((r) => {
          const [label, chip] = CLASS_CHIP[r.cls];
          return (
            <tr key={r.field}>
              <th scope="row" className={`${TD} text-left font-semibold`}>{r.field}</th>
              <td className={`${TD} font-mono`}>{r.value}</td>
              <td className={TD}>
                <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em] uppercase ${chip}`}>{label}</span>
              </td>
              <td className={`${TD} text-muted`}>{r.limit}</td>
            </tr>
          );
        })}
      </Table>
      <Note>
        Thresholds, cooldown, mutation rate and spend caps are not part of the genome: they are protocol constants, the same for everyone, and are never
        inherited or mutated.
      </Note>
    </Card>
  );
}

/* ---------- Trades ---------- */

export function TradesPanel({ trades }: { trades: Trade[] }) {
  return (
    <Card>
      <CardHead title="Recent trades">
        <Tag>Kuru</Tag>
      </CardHead>
      {trades.length === 0 ? (
        <p className="text-sm text-muted">No trades yet.</p>
      ) : (
        <Table
          caption="Recent trade proposals and the policy decision on each"
          head={<><th className={TH}>Tick</th><th className={TH}>Pair</th><th className={TH}>Side</th><th className={`${TH} ${R}`}>Size</th><th className={`${TH} ${R}`}>Slippage</th><th className={`${TH} ${R}`}>Result</th><th className={TH}>Policy</th></>}
        >
          {trades.map((t, i) => (
            <tr key={`${t.tick}-${i}`} className="hover:bg-surface-2">
              <td className={`${TD} font-mono`}>#{t.tick}</td>
              <td className={`${TD} font-mono`}>{t.pair}</td>
              <td className={`${TD} ${t.side === "buy" ? "text-good" : "text-bad"}`}>{t.side === "buy" ? "Buy" : "Sell"}</td>
              <td className={`${TD} ${R} font-mono tabular`}>{usd(t.size)}</td>
              <td className={`${TD} ${R} font-mono tabular`}>{t.slippagePct === null ? <None spoken="Not executed" /> : `${t.slippagePct.toFixed(2)}%`}</td>
              <td className={`${TD} ${R} font-mono tabular ${t.pnl === null ? "" : t.pnl >= 0 ? "text-good" : "text-bad"}`}>
                {t.pnl === null ? <None spoken="Not executed" /> : `${t.pnl >= 0 ? "+" : ""}${usd(t.pnl)}`}
              </td>
              <td className={TD}>
                {t.decision.approved ? (
                  <Pill tone="good">Approved</Pill>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Pill tone="bad">Rejected</Pill>
                    <span className="text-xs text-muted">
                      <span className="sr-only">Reason: </span>
                      {t.decision.reason}
                    </span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Note>Rejected proposals are not executed and spend no capital. The reason also appears in Events.</Note>
    </Card>
  );
}

/* ---------- x402 purchases ---------- */

const PROVIDER: Record<Provider, { name: string; tone: "berry" | "accent" }> = {
  nansen: { name: "Nansen", tone: "berry" },
  defillama: { name: "DeFiLlama", tone: "accent" },
};

export function PurchasesPanel({ purchases }: { purchases: X402Purchase[] }) {
  return (
    <Card>
      <CardHead title="Information purchases">
        <span className="text-[13px] text-muted">Every payment is logged with its outcome</span>
      </CardHead>
      {purchases.length === 0 ? (
        <p className="text-sm text-muted">No purchases yet.</p>
      ) : (
        <Table
          caption="x402 information purchases and whether each changed the decision"
          head={<><th className={TH}>Tick</th><th className={TH}>Provider</th><th className={TH}>Query</th><th className={`${TH} ${R}`}>Cost</th><th className={TH}>Changed the decision?</th></>}
        >
          {purchases.map((p, i) => (
            <tr key={`${p.tick}-${i}`} className="hover:bg-surface-2">
              <td className={`${TD} font-mono`}>#{p.tick}</td>
              <td className={TD}>
                <Pill tone={PROVIDER[p.provider].tone}>{PROVIDER[p.provider].name}</Pill>
              </td>
              <td className={`${TD} text-muted`}>{p.query}</td>
              <td className={`${TD} ${R} font-mono tabular`}>{usd(p.cost)}</td>
              <td className={TD}>{p.changedDecision ? <Pill tone="good">Yes</Pill> : <Pill tone="off">No</Pill>}</td>
            </tr>
          ))}
        </Table>
      )}
      <Note>Provider responses are treated as untrusted data. They can never trigger a transaction on their own.</Note>
    </Card>
  );
}

/* ---------- Reproduction ---------- */

export function ReproductionPanel({ agent, checks }: { agent: Agent; checks: EligibilityCheck[] }) {
  const okN = checks.filter((c) => c.ok).length;
  const all = okN === checks.length;
  const profit = Math.max(0, agent.capital - agent.principal);
  const { childCapital, parentCapitalAfter } = allocateCapital({
    capital: agent.capital,
    principal: agent.principal,
    fraction: PROTOCOL.reproductionFraction,
    maxChildCapital: PROTOCOL.principal,
  });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHead title="Conditions to reproduce">{all ? <Pill tone="good">Eligible</Pill> : <Pill tone="off">{okN} of {checks.length}</Pill>}</CardHead>
        <ul className="m-0 grid list-none gap-2.5 p-0">
          {checks.map((c) => (
            <li key={c.key} className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-3">
              <span className={`grid size-7 place-items-center rounded-full ${c.ok ? "bg-good-wash text-good" : "bg-bad-wash text-bad"}`}>
                <Icon name={c.ok ? "check" : "x"} className="size-4" />
              </span>
              <div className="min-w-0">
                <b>
                  <span className="sr-only">{c.ok ? "Met: " : "Not met: "}</span>
                  {c.label}
                </b>
                <small className="block text-xs text-muted">{c.detail}</small>
              </div>
            </li>
          ))}
        </ul>
        <Note>
          Evaluated every {PROTOCOL.evalEvery} ticks, never on a single tick. At most {PROTOCOL.maxDescendants} children per agent; this one has{" "}
          {agent.childIds.length}.
        </Note>
      </Card>
      <Card>
        <CardHead title="If it reproduced today">{!all && <span className="text-[13px] text-muted">Illustration only: not eligible yet</span>}</CardHead>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
          <dt className="text-muted">Profit above principal</dt>
          <dd className="m-0 text-right font-mono tabular">{usd(profit)}</dd>
          <dt className="text-muted">{Math.round(PROTOCOL.reproductionFraction * 100)}% of profit</dt>
          <dd className="m-0 text-right font-mono tabular">{usd(PROTOCOL.reproductionFraction * profit)}</dd>
          <dt className="text-muted">Per-child cap</dt>
          <dd className="m-0 text-right font-mono tabular">{usd(PROTOCOL.principal)}</dd>
          <dt className="font-bold text-fg">Child&apos;s capital</dt>
          <dd className="m-0 text-right font-mono text-lg font-bold text-accent-hi tabular">{usd(childCapital)}</dd>
          <dt className="text-muted">Parent capital after</dt>
          <dd className="m-0 text-right font-mono tabular">{usd(parentCapitalAfter)}</dd>
        </dl>
        <div className="mt-4 flex items-start gap-3 rounded-[14px] bg-good-wash px-4 py-3.5 text-sm">
          <span className="mt-0.5 text-good">
            <Icon name="shield" />
          </span>
          <span>
            The parent never drops below its principal ({usd(agent.principal)}). The transfer is atomic on-chain: the system does not create capital, it
            reallocates it.
          </span>
        </div>
      </Card>
    </div>
  );
}
