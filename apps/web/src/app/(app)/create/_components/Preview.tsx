import { riskBand } from "@monadeum/fitness/math";
import { CAPITAL_FLOOR, EVALUATION_CADENCE, RETIREMENT_WINDOWS } from "@monadeum/reallocation/constants";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { Card, Identicon, Pill } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { Agent } from "@/data/types";
import { usd } from "@/lib/format";
import { previewHash, type Draft } from "./draft";

export const identicon = (draft: Draft) => ({ genome: { hash: previewHash(draft) }, status: "active" as const });

export const NICHE_COUNT = PROTOCOL.riskCuts.length + 1;

export function Preview({ draft, amount }: { draft: Draft; amount: number }) {
  const rows: [string, string][] = [
    ["Max risk", `${draft.riskTolerance.toFixed(2)} · niche ${riskBand(draft.riskTolerance) + 1} of ${NICHE_COUNT}`],
    ["Tick", `every ${draft.executionFrequency}`],
    ["Pairs", draft.assetUniverse.join(", ")],
    ["Information", `${usd(draft.informationBudget)} / tick`],
    ["Model", draft.modelConfiguration],
    ["Principal", usd(amount)],
  ];
  return (
    <Card className="flex flex-col gap-3.5 lg:sticky lg:top-[84px]">
      <div className="flex items-center gap-3.5">
        <Identicon agent={identicon(draft)} className="size-14 rounded-2xl" />
        <div className="min-w-0">
          <span className="eyebrow">Preview</span>
          <div className="mt-1 font-display text-[22px] font-bold">New agent</div>
          <Pill tone="accent">Fixed genome</Pill>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 text-right font-mono break-words tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-1.5 border-t border-line-soft pt-3.5 text-[13px]">
        <span className="eyebrow">Once it is running</span>
        <span className="flex items-start gap-2">
          <Icon name="check" className="mt-0.5 size-4 flex-none text-good" />
          Ranked every {EVALUATION_CADENCE} ticks, once it has trades in the window
        </span>
        <span className="flex items-start gap-2">
          <Icon name="check" className="mt-0.5 size-4 flex-none text-good" />
          Capital moves to or from your other agents only under a reallocation policy you sign. Off by default
        </span>
        <span className="flex items-start gap-2">
          <Icon name="check" className="mt-0.5 size-4 flex-none text-good" />
          <span>
            Retires below <b className="font-mono tabular">{usd(CAPITAL_FLOOR)}</b>, or after {RETIREMENT_WINDOWS} evaluations in a row in the
            bottom tenth of its niche. Its balance stays in its account
          </span>
        </span>
      </div>
    </Card>
  );
}
