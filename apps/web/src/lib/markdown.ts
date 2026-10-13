import { DEPLOYMENT } from "@/data/evidence/deployments";
import { CHAIN_ID, EVIDENCE_EXPLORER, EVIDENCE_RPC } from "@/data/evidence/explorer";
import { API_ORIGIN, DOCS_URL, EVIDENCE_DESCRIPTION, HOME_DESCRIPTION, PUBLIC_PAGES, SITE_URL } from "./site";

// Hand-written markdown versions of the public pages, served for `Accept: text/markdown`. They state only what the
// README and the documentation site already state, and carry no dated status: the live state is on the evidence page,
// which re-reads the chain, so a dated sentence here could only go stale.

const contracts = Object.entries(DEPLOYMENT.contracts)
  .map(([name, address]) => `- \`${name}\`: [\`${address}\`](${EVIDENCE_EXPLORER}/address/${address})`)
  .join("\n");

const endpoints = [
  `- Evidence page: ${SITE_URL}/evidence`,
  API_ORIGIN ? `- Public evidence API, no sign-in: \`GET ${API_ORIGIN}/public/evidence\` (JSON, read-only, rate limited)` : null,
  API_ORIGIN ? `- API liveness: \`GET ${API_ORIGIN}/health\`` : null,
  API_ORIGIN ? `- API catalog: ${SITE_URL}/.well-known/api-catalog` : null,
  `- Documentation, published separately: ${DOCS_URL}`,
]
  .filter((l): l is string => l !== null)
  .join("\n");

const verify = `\`\`\`bash
export RPC=${EVIDENCE_RPC}
cast chain-id --rpc-url $RPC   # ${CHAIN_ID}
cast call ${DEPLOYMENT.contracts.AgentReallocation} "operator()(address)" --rpc-url $RPC
cast call ${DEPLOYMENT.contracts.AgentSpendPolicy} "settlementAsset()(address)" --rpc-url $RPC
\`\`\``;

export const HOME_MARKDOWN = `# Monadeum

${HOME_DESCRIPTION}

Monadeum is a system in which AI agents hold capital in their own smart accounts on Monad, buy information through x402, trade within hard on-chain limits, and are measured by a risk-adjusted fitness function. A language model only proposes. A deterministic policy engine decides whether the resulting transaction is allowed, and each agent's account enforces its own caps and call allowlist on chain as an independent second check.

Everything runs on Monad testnet (chain ${CHAIN_ID}) with testnet assets only. No contract is audited or on mainnet.

## Live endpoints

${endpoints}

Every other API endpoint requires a signed-in session. Sign-in is at ${SITE_URL}/login.

## Verify on chain

Contracts deployed on Monad testnet:

${contracts}

The values below are read from the public RPC, not from this site:

${verify}

The evidence page re-checks every record it lists against the chain in the visitor's browser. A record is marked verified only when every comparison matched; anything else, including an unreachable RPC, is marked unverified.

## Status

What has and has not happened (trades, x402 payments, which components run) changes over time. It is stated, with dates, in the repository README and on the evidence page, and this page does not restate it. The testnet market is created and seeded by the team, so profit and loss on it is not evidence of skill. Reallocation between an owner's agents is off by default.
`;

export const EVIDENCE_MARKDOWN = `# On-chain evidence

${EVIDENCE_DESCRIPTION}

${SITE_URL}/evidence is an interactive page: it loads in the browser, reads ${API_ORIGIN ? `\`GET ${API_ORIGIN}/public/evidence\`` : "the public evidence endpoint of the API"} and the deployment record, and re-checks each record against the public Monad testnet RPC. The records themselves are therefore not in this markdown; fetch the JSON endpoint or open the page.

## What the page lists

- The three deployed contracts, with live reads of their configuration.
- Agent accounts and their indexed spend-policy events: deployments, limits, allowlist entries, and spends.
- Trades and x402 payments that carry a transaction reference, if any exist.
- Reallocation and retirement reads, limited to what contract reads support.
- Copyable \`cast\` and viem commands to repeat the checks.

If a category has no records, the page says so. It does not fill an empty category with sample data.

## Contracts

${contracts}

Deployment record: \`contracts/deployments/monad-testnet.json\` in the repository.

## Verify without this site

${verify}

## Verification rule

Fail closed. A record is verified only when the receipt exists, succeeded, and matches the recorded block, sender, and log. A mismatch, a missing or reverted receipt, a malformed value, an RPC error, or an unreachable RPC all show as unverified.
`;

const PAGES: Record<string, string> = { home: HOME_MARKDOWN, evidence: EVIDENCE_MARKDOWN };

/** Public paths that have a markdown version, and the markdown route name behind each. Derived from PUBLIC_PAGES. */
export const MARKDOWN_PAGES: Readonly<Record<string, string>> = Object.fromEntries(PUBLIC_PAGES.filter((p) => p.markdown).map((p) => [p.path, p.path === "/" ? "home" : p.path.slice(1)]));

export function markdownFor(name: string): string | null {
  return Object.values(MARKDOWN_PAGES).includes(name) ? (PAGES[name] ?? null) : null;
}

/** A rough size estimate for the `x-markdown-tokens` header: about four characters per token. A heuristic, not a tokenizer's count. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function markdownResponse(name: string): Response {
  const body = markdownFor(name);
  if (body === null) return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(body, {
    headers: { "content-type": "text/markdown; charset=utf-8", vary: "Accept", "x-markdown-tokens": String(estimateTokens(body)) },
  });
}
