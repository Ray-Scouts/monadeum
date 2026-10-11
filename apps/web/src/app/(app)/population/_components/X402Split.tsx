import { Card, CardHead, Tag } from "@/components/ui";
import type { Provider, X402Spend } from "@/data/types";
import { usd } from "@/lib/format";

const PROVIDER: Record<Provider, { name: string; color: string }> = {
  nansen: { name: "Nansen", color: "var(--berry)" },
  defillama: { name: "DeFiLlama", color: "var(--accent)" },
};

export interface ShareItem {
  key: string;
  name: string;
  /** The amount as text, already formatted. */
  display: string;
  /** Fraction of the total, 0 to 1. */
  share: number;
  color: string;
}

/** One labeled bar per item, its length the item's share of the total. */
export function ShareBars({ items, of }: { items: ShareItem[]; of: string }) {
  return (
    <>
      {items.map((p) => (
        <div key={p.key} className="grid gap-1.5">
          <div className="flex justify-between gap-3 text-sm">
            <span>{p.name}</span>
            <span className="font-mono tabular">{p.display}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${p.name}: ${Math.round(p.share * 100)}% of ${of}`}>
            <span className="block h-full rounded-full" style={{ width: `${p.share * 100}%`, background: p.color }} />
          </div>
        </div>
      ))}
    </>
  );
}

export function X402Split({ spend }: { spend: X402Spend }) {
  const total = spend.byProvider.reduce((s, p) => s + p.spent, 0);
  return (
    <Card>
      <CardHead title="Today's x402 spend">
        <Tag>by provider</Tag>
      </CardHead>
      <div className="grid gap-3">
        <ShareBars
          of="today's x402 spend"
          items={spend.byProvider.map((p) => ({
            key: p.provider,
            name: PROVIDER[p.provider].name,
            display: usd(p.spent),
            share: p.spent / (total || 1),
            color: PROVIDER[p.provider].color,
          }))}
        />
        <p className="text-xs text-muted">
          {spend.changedDecision} of {spend.purchases} purchases changed the agent&apos;s decision.
        </p>
      </div>
    </Card>
  );
}
