import { NANSEN_NETFLOW_ENDPOINT, NansenClient } from "../src/nansen.js";

/**
 * One live Nansen Smart Money call, for the owner to run (ARCHITECTURE.md section 8.1). Reads NANSEN_API_KEY from the
 * environment, validates the response through the same schema the worker uses, and prints a redacted record. The key
 * is never printed. Costs one call, about 5 Nansen credits.
 *
 *   bun run nansen:probe              the signal for NANSEN_TOKEN_ADDRESS
 *   bun run nansen:probe -- --list    the top rows Nansen returns for chain monad, with no token filter
 */
const apiKey = process.env.NANSEN_API_KEY?.trim();
if (!apiKey) {
  console.error("NANSEN_API_KEY is not set. Nothing was called. Run: NANSEN_API_KEY=... NANSEN_TOKEN_ADDRESS=0x... bun run nansen:probe");
  process.exit(2);
}

if (process.argv.includes("--list")) {
  console.log("Nansen netflow listing for chain monad, no token filter. This is ONE call and costs about 5 credits.");
  const listing = await new NansenClient({ apiKey }).listNetflow(20);
  const usage = listing.usage;
  const credits = usage ? `credits used ${usage.credits}${usage.estimated ? " (estimated)" : ""}, remaining ${usage.creditsRemaining ?? "unknown"}` : "no call made";
  console.log(`${usage?.at ?? new Date().toISOString()} POST ${NANSEN_NETFLOW_ENDPOINT} status ${usage?.status ?? "none"} outcome ${usage?.outcome ?? "none"}`);
  if (!listing.ok) {
    console.log(`no rows: ${listing.reason}`);
    console.log(credits);
    process.exit(1);
  }
  console.log(`${listing.rows.length} row(s):`);
  for (const row of listing.rows) console.log(`${row.symbol.padEnd(12)} ${row.tokenAddress} net flow 24h USD ${row.netFlow24hUsd}`);
  console.log(credits);
  process.exit(0);
}

const tokenAddress = process.env.NANSEN_TOKEN_ADDRESS?.trim();
if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
  console.error("NANSEN_TOKEN_ADDRESS must be a Monad mainnet token address (0x followed by 40 hex characters). Nothing was called. Use --list to see which tokens Nansen returns.");
  process.exit(2);
}

const client = new NansenClient({ apiKey, tokenAddress });
const result = await client.smartMoneySignal();
const proof = {
  timestamp: result.usage?.at ?? new Date().toISOString(),
  endpoint: `POST ${NANSEN_NETFLOW_ENDPOINT}`,
  httpStatus: result.usage?.status ?? null,
  outcome: result.usage?.outcome ?? "none",
  signal: result.ok ? result.signal : null,
  reason: result.ok ? null : result.reason,
  smartMoneyNetFlow24hUsd: result.ok ? result.row.netFlow24hUsd : null,
  creditsUsed: result.usage?.credits ?? null,
  creditsEstimated: result.usage?.estimated ?? null,
  creditsRemaining: result.usage?.creditsRemaining ?? null,
  token: tokenAddress,
  apiKey: "redacted",
};
console.log(JSON.stringify(proof, null, 2));
process.exit(result.ok ? 0 : 1);
