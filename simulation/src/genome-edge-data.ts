import { readFileSync } from "node:fs";

// Bar construction for the genome-edge study (issue #102, preregistration section 2).

export const IN_SAMPLE_START = Date.UTC(2025, 10, 25) / 1000;
export const HELD_OUT_START = Date.UTC(2026, 5, 1) / 1000;
export const HELD_OUT_END = Date.UTC(2026, 9, 1) / 1000;
/** Kuru's Trade event carries the price scaled by 1e18, quote per base (checked against Coinbase, see genome-edge.md). */
export const KURU_PRICE_SCALE = 1e18;
const HOUR = 3600;

/** Data lines of a CSV, header skipped, read from a Buffer so files above the string size limit work. */
export function* csvLines(path: string): Generator<string> {
  const buffer = readFileSync(path);
  let start = buffer.indexOf(10) + 1;
  while (start > 0 && start < buffer.length) {
    let end = buffer.indexOf(10, start);
    if (end < 0) end = buffer.length;
    if (end > start) yield buffer.toString("utf8", start, end);
    start = end + 1;
  }
}

export interface HourlySeries {
  /** Hour start, unix seconds, one per hour from `start` to `end` exclusive. */
  hours: number[];
  /** Close; NaN until the first observed price. */
  close: number[];
  /** Trades (or candles present) in the hour, for the coverage check. */
  count: number[];
}

/** Last trade of each hour after dropping trades more than 5 percent from that hour's median price. */
export function kuruHourly(tradesCsv: string, start: number, end: number, scale = KURU_PRICE_SCALE): HourlySeries {
  const byHour = new Map<number, { order: number; price: number }[]>();
  for (const line of csvLines(tradesCsv)) {
    const [block, logIndex, timestamp, , priceRaw] = line.split(",");
    const ts = Number(timestamp);
    if (ts < start - HOUR || ts >= end) continue;
    const hour = Math.floor(ts / HOUR) * HOUR;
    const price = Number(BigInt(priceRaw as string)) / scale;
    const order = Number(block) * 100_000 + Number(logIndex);
    const list = byHour.get(hour) ?? [];
    list.push({ order, price });
    byHour.set(hour, list);
  }
  const hours: number[] = [];
  const close: number[] = [];
  const count: number[] = [];
  let last = Number.NaN;
  for (let h = start - HOUR; h < end; h += HOUR) {
    const trades = byHour.get(h) ?? [];
    if (trades.length > 0) {
      const sorted = trades.map((t) => t.price).sort((a, b) => a - b);
      const mid = sorted.length % 2 ? (sorted[(sorted.length - 1) / 2] as number) : ((sorted[sorted.length / 2 - 1] as number) + (sorted[sorted.length / 2] as number)) / 2;
      const kept = trades.filter((t) => Math.abs(t.price / mid - 1) <= 0.05).sort((a, b) => a.order - b.order);
      if (kept.length > 0) last = (kept[kept.length - 1] as { price: number }).price;
    }
    hours.push(h);
    close.push(last);
    count.push(trades.length);
  }
  return { hours, close, count };
}

export function coinbaseHourly(csv: string, start: number, end: number): HourlySeries {
  const map = new Map<number, number>();
  for (const line of readFileSync(csv, "utf8").trim().split("\n").slice(1)) {
    const parts = line.split(",");
    map.set(Number(parts[0]), Number(parts[4]));
  }
  const hours: number[] = [];
  const close: number[] = [];
  const count: number[] = [];
  let last = Number.NaN;
  for (let h = start - HOUR; h < end; h += HOUR) {
    const value = map.get(h);
    if (value !== undefined) last = value;
    hours.push(h);
    close.push(last);
    count.push(value === undefined ? 0 : 1);
  }
  return { hours, close, count };
}

/**
 * Simple returns of each hour from `start` (index 0 of the returned arrays is the first hour at or after `start`). A
 * return with no previous price is NaN.
 */
export function hourlyReturns(series: HourlySeries): { hours: number[]; returns: number[]; count: number[] } {
  const hours: number[] = [];
  const returns: number[] = [];
  const count: number[] = [];
  for (let i = 1; i < series.hours.length; i++) {
    const prev = series.close[i - 1] as number;
    const cur = series.close[i] as number;
    hours.push(series.hours[i] as number);
    returns.push(Number.isFinite(prev) && Number.isFinite(cur) ? cur / prev - 1 : Number.NaN);
    count.push(series.count[i] as number);
  }
  return { hours, returns, count };
}
