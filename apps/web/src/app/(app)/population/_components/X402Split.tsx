import { Card, CardHead, Tag } from "@/components/ui";
import type { Provider, X402Spend } from "@/data/types";
import { usd } from "@/lib/format";

const PROVIDER: Record<Provider, { name: string; color: string }> = {
  nansen: { name: "Nansen", color: "var(--berry)" },
  defillama: { name: "DeFiLlama", color: "var(--accent)" },
};

export function X402Split({ spend }: { spend: X402Spend }) {
  const total = spend.byProvider.reduce((s, p) => s + p.spent, 0);
  return (
    <Card>
      <CardHead title="Today's x402 spend">
        <Tag>by provider</Tag>
      </CardHead>
      <div className="grid gap-3">
        {spend.byProvider.map((p) => (
          <div key={p.provider} className="grid gap-1.5">
            <div className="flex justify-between text-sm">
              <span>{PROVIDER[p.provider].name}</span>
              <span className="font-mono tabular">{usd(p.spent)}</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-surface-2"
              role="img"
              aria-label={`${PROVIDER[p.provider].name}: ${Math.round((p.spent / (total || 1)) * 100)}% of today's x402 spend`}
            >
              <span className="block h-full rounded-full" style={{ width: `${(p.spent / (total || 1)) * 100}%`, background: PROVIDER[p.provider].color }} />
            </div>
          </div>
        ))}
        <p className="text-xs text-muted">
          {spend.changedDecision} of {spend.purchases} purchases changed the agent&apos;s decision.
        </p>
      </div>
    </Card>
  );
}
