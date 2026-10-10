import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Issue #102, genome-edge study. Fetches the raw inputs named in `results/genome-edge-preregistration.md` section 2:
// every Trade event of the Kuru mainnet MON-USDC market over the study range, and Coinbase Exchange MON-USD hourly
// candles over the same hours. Read-only: no key, no transaction. Usage, from `simulation/` after `tsc`:
//   SOURCE=kuru node dist/src/cli-genome-edge-fetch.js
//   SOURCE=coinbase node dist/src/cli-genome-edge-fetch.js
// Output goes to `data/genome-edge/raw/` (not committed; see `data/genome-edge/README.md`). The Kuru fetch is
// resumable: finished chunks are recorded in `kuru-chunks.csv` and skipped on a re-run.

export const KURU_MARKET = "0x065C9d28E428A0db40191a54d33d5b7c71a9C394";
/** keccak256("Trade(uint40,address,bool,uint256,uint96,address,address,uint96)"), the event in the issue #20 spike ABI. */
export const TRADE_TOPIC = "0xf16924fba1c18c108912fcacaac7450c98eb3f2d8c0a3cdf3df7066c08f21581";
export const MONAD_CHAIN_ID = 143;
/** First fetched hour: one day before the in-sample start, so the first in-sample bar has a previous close. */
export const FETCH_START = Date.UTC(2025, 10, 24, 0, 0, 0) / 1000;
/** Exclusive end: the hour after the last held-out bar. */
export const FETCH_END = Date.UTC(2026, 9, 1, 0, 0, 0) / 1000;
const CHUNK = 5000;

const RPC = process.env.RPC ?? "https://rpc2.monad.xyz";
const OUT_DIR = resolve(process.env.OUT_DIR ?? "data/genome-edge/raw");

async function rpc<T>(method: string, params: unknown[], attempt = 0): Promise<T> {
  try {
    const response = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result as T;
  } catch (error) {
    if (attempt >= 8) throw error;
    await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
    return rpc<T>(method, params, attempt + 1);
  }
}

async function blockTime(block: number): Promise<number> {
  const header = await rpc<{ timestamp: string }>("eth_getBlockByNumber", [`0x${block.toString(16)}`, false]);
  return Number.parseInt(header.timestamp, 16);
}

/** First block whose timestamp is at or after `ts`. */
async function firstBlockAtOrAfter(ts: number, low: number, high: number): Promise<number> {
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((await blockTime(mid)) < ts) low = mid + 1;
    else high = mid;
  }
  return low;
}

interface RawLog {
  data: string;
  blockNumber: string;
  logIndex: string;
  blockTimestamp?: string;
}

/** Decodes the non-indexed Trade data: orderId, maker, isBuy, price, updatedSize, taker, origin, filledSize. */
export function decodeTrade(data: string): { isBuy: boolean; price: bigint; filledSize: bigint } {
  const word = (index: number): bigint => BigInt(`0x${data.slice(2 + index * 64, 2 + (index + 1) * 64)}`);
  if (data.length !== 2 + 8 * 64) throw new Error(`unexpected Trade data length ${data.length}`);
  return { isBuy: word(2) !== 0n, price: word(3), filledSize: word(7) };
}

async function fetchKuru(): Promise<void> {
  const chainId = Number.parseInt(await rpc<string>("eth_chainId", []), 16);
  if (chainId !== MONAD_CHAIN_ID) throw new Error(`RPC chain id ${chainId} is not Monad mainnet (${MONAD_CHAIN_ID})`);
  const head = Number.parseInt(await rpc<string>("eth_blockNumber", []), 16);
  const startBlock = await firstBlockAtOrAfter(FETCH_START, 1, head);
  const endBlock = (await firstBlockAtOrAfter(FETCH_END, startBlock, head)) - 1;
  console.error(`blocks ${startBlock} to ${endBlock}`);
  mkdirSync(OUT_DIR, { recursive: true });
  const chunksFile = resolve(OUT_DIR, "kuru-chunks.csv");
  const tradesFile = resolve(OUT_DIR, "kuru-trades.csv");
  const done = new Set<number>();
  if (existsSync(chunksFile)) {
    for (const line of readFileSync(chunksFile, "utf8").trim().split("\n").slice(1)) done.add(Number(line.split(",")[0]));
  } else {
    writeFileSync(chunksFile, "from_block,to_block,trades\n");
    writeFileSync(tradesFile, "block,log_index,timestamp,is_buy,price_raw,filled_size_raw\n");
  }
  const starts: number[] = [];
  for (let from = startBlock; from <= endBlock; from += CHUNK) if (!done.has(from)) starts.push(from);
  const concurrency = Number(process.env.CONCURRENCY ?? 6);
  let next = 0;
  let finished = 0;
  const worker = async (): Promise<void> => {
    while (next < starts.length) {
      const from = starts[next++] as number;
      const to = Math.min(endBlock, from + CHUNK - 1);
      const logs = await rpc<RawLog[]>("eth_getLogs", [
        { address: KURU_MARKET, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [TRADE_TOPIC] },
      ]);
      const lines = logs.map((log) => {
        if (!log.blockTimestamp) throw new Error("RPC did not return blockTimestamp");
        const trade = decodeTrade(log.data);
        return `${Number.parseInt(log.blockNumber, 16)},${Number.parseInt(log.logIndex, 16)},${Number.parseInt(log.blockTimestamp, 16)},${trade.isBuy ? 1 : 0},${trade.price},${trade.filledSize}`;
      });
      if (lines.length > 0) appendFileSync(tradesFile, `${lines.join("\n")}\n`);
      appendFileSync(chunksFile, `${from},${to},${logs.length}\n`);
      finished += 1;
      if (finished % 200 === 0) console.error(`${finished} / ${starts.length} chunks`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.error(`done: ${starts.length} chunks fetched this run`);
}

async function fetchCoinbase(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const rows = new Map<number, string>();
  const step = 300 * 3600;
  for (let start = FETCH_START; start < FETCH_END; start += step) {
    const end = Math.min(FETCH_END - 3600, start + step - 3600);
    const url = `https://api.exchange.coinbase.com/products/MON-USD/candles?granularity=3600&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
    const response = await fetch(url, { headers: { "user-agent": "monadeum-genome-edge-study" } });
    if (!response.ok) throw new Error(`Coinbase HTTP ${response.status} for ${url}`);
    const candles = (await response.json()) as [number, number, number, number, number, number][];
    for (const [time, low, high, open, close, volume] of candles) {
      if (time >= FETCH_START && time < FETCH_END) rows.set(time, `${time},${open},${high},${low},${close},${volume}`);
    }
    await new Promise((done) => setTimeout(done, 400));
  }
  const sorted = [...rows.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
  writeFileSync(resolve(OUT_DIR, "coinbase-mon-usd-1h.csv"), `time,open,high,low,close,volume\n${sorted.join("\n")}\n`);
  console.error(`coinbase: ${sorted.length} candles`);
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (process.argv[1]?.endsWith("cli-genome-edge-fetch.js")) {
  const source = process.env.SOURCE;
  if (source === "kuru") await fetchKuru();
  else if (source === "coinbase") await fetchCoinbase();
  else throw new Error("SOURCE must be kuru or coinbase");
}
