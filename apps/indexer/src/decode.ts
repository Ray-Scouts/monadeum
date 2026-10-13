import { decodeEventLog, pad, type Address, type Hex } from "viem";
import { selectors } from "./registry.js";
import type { EventHandler, HandledEvent, LogQuery, RawLog } from "./types.js";

/**
 * Decodes one log through a handler. Returns null for a log with a matching selector that does not decode (for example
 * a different contract's event with the same name and argument types but other indexing), and for one the handler
 * ignores. Shared by the sync loop and the HyperSync cross-check, so both read a log the same way.
 */
export function decodeRow(handler: EventHandler, log: RawLog): HandledEvent | null {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: handler.events, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true });
  } catch {
    return null;
  }
  return handler.handle({ eventName: decoded.eventName as string, args: (decoded.args ?? {}) as Record<string, unknown> }, log);
}

/**
 * The log queries one handler needs over `[from, to]` (both inclusive). `accounts` are the followed accounts, used by
 * the account-restricted sources and chunked to at most `addressChunk` per query. Shared by the sync loop and the
 * HyperSync cross-check, so the two sources are asked the same question.
 */
export function logQueries(handler: EventHandler, from: bigint, to: bigint, accounts: readonly Address[], addressChunk: number): LogQuery[] {
  const topic0 = selectors(handler);
  const source = handler.source;
  const queries: LogQuery[] = [];
  if (source.kind === "contract") {
    queries.push({ fromBlock: from, toBlock: to, address: [source.address], topics: [topic0] });
    return queries;
  }
  for (let i = 0; i < accounts.length; i += addressChunk) {
    const chunk = accounts.slice(i, i + addressChunk);
    if (source.kind === "account") {
      queries.push({ fromBlock: from, toBlock: to, address: chunk, topics: [topic0] });
    } else {
      const topics: (Hex[] | null)[] = [topic0, null, null, null].slice(0, source.accountTopic + 1);
      topics[source.accountTopic] = chunk.map((a) => pad(a, { size: 32 }));
      queries.push({ fromBlock: from, toBlock: to, address: [source.address], topics });
    }
  }
  return queries;
}
