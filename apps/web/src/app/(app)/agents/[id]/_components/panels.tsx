import { PROTOCOL } from "monadeum-simulation/protocol";
import type { ReactNode } from "react";
import { Card, CardHead, Pill, Tag } from "@/components/ui";
import type { Agent, Provider, Trade, X402Purchase } from "@/data/types";
import { usd } from "@/lib/format";

const TH = "whitespace-nowrap border-b border-line-soft px-3 py-2.5 text-left font-mono text-xs font-medium tracking-[0.08em] text-faint uppercase";
const TD = "whitespace-nowrap border-b border-line-soft px-3 py-3 align-middle";
const R = "text-right";

function Table({ caption, head, children }: { caption: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-5 scroll-hint overflow-x-auto px-5">
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

type GenomeClass = "fixed" | "allowlist" | "capped";
const CLASS_CHIP: Record<GenomeClass, [string, string]> = {
  fixed: ["Single option", "border border-line bg-surface-2 text-muted"],
  allowlist: ["Allowlist", "bg-accent-wash text-accent-hi"],
  capped: ["Capped", "bg-berry-wash text-berry"],
};

export function GenomePanel({ agent }: { agent: Agent }) {
  const g = agent.genome;
  const rows: { field: string; value: ReactNode; cls: GenomeClass; limit: string }[] = [
    { field: "Strategy", value: "Trading", cls: "fixed", limit: "Only one strategy plugin in the MVP" },
    {
      field: "Asset universe",
      value: <span className="flex flex-wrap gap-1.5">{g.assetUniverse.map((p) => <Tag key={p}>{p}</Tag>)}</span>,
      cls: "allowlist",
      limit: "Subset of the platform allowlist",
    },
    { field: "Risk tolerance", value: g.riskTolerance.toFixed(3), cls: "capped", limit: `${PROTOCOL.riskFloor} to ${PROTOCOL.riskCeiling} of capital` },
    { field: "Tick interval", value: `${g.executionFrequency} ticks`, cls: "capped", limit: `${PROTOCOL.frequencyMin} to ${PROTOCOL.frequencyMax} ticks` },
    {
      field: "Signal horizon",
      value: `${g.timeHorizon} ticks`,
      cls: "capped",
      limit: `Validated by the strategy plugin. The simulation clips it to ${PROTOCOL.timeHorizonMin} to ${PROTOCOL.timeHorizonMax} ticks`,
    },
    {
      field: "Information budget",
      value: `${usd(g.informationBudget)} / tick`,
      cls: "capped",
      limit: `Protocol daily spend ceiling. The simulation clips it at ${PROTOCOL.informationBudgetCeiling} per tick`,
    },
    { field: "Model configuration", value: g.modelConfiguration, cls: "allowlist", limit: `Allowed set: ${PROTOCOL.allowedModels.join(", ")}` },
  ];
  return (
    <Card>
      <CardHead title="Genome">
        <span className="font-mono text-[13px] text-muted">hash {g.hash}</span>
      </CardHead>
      <Table caption="Genome fields, how each is bounded, and the protocol limit" head={<><th className={TH}>Field</th><th className={TH}>Value</th><th className={TH}>Bound</th><th className={TH}>Protocol limit</th></>}>
        {rows.map((r) => {
          const [label, chip] = CLASS_CHIP[r.cls];
          return (
            <tr key={r.field}>
              <th scope="row" className={`${TD} text-left font-semibold`}>{r.field}</th>
              <td className={`${TD} font-mono`}>{r.value}</td>
              <td className={TD}>
                <span className={`rounded px-1.5 py-0.5 font-mono text-xs tracking-[0.06em] uppercase ${chip}`}>{label}</span>
              </td>
              <td className={`${TD} text-muted`}>{r.limit}</td>
            </tr>
          );
        })}
      </Table>
      <Note>
        The genome is set when the owner creates the agent and does not change afterwards, by the protocol or by the owner. The reallocation cap, the
        slot ceiling, the capital floor and the spend caps are not part of it: they are protocol constants, the same for everyone.
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
