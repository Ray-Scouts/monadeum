import { acceptQuote, acceptTokenField } from "@monadeum/external";
import { propose, type Action, type AgentView, type Quote } from "@monadeum/strategy";

export type TickRetry = "next-tick" | "none";

export interface TickResult {
  action: "none" | "executed";
  retry: TickRetry;
  key: string;
}

export interface TickRecord {
  key: string;
  status: "started" | "submitted" | "recorded";
  userOpHash?: string;
}

export interface TickStore {
  get(key: string): TickRecord | undefined;
  put(record: TickRecord): boolean;
}

export function tickKey(agentId: string, tick: number): string {
  return `${agentId}:${tick}`;
}

export function enqueueTick(store: TickStore, agentId: string, tick: number): boolean {
  return store.put({ key: tickKey(agentId, tick), status: "started" });
}

export interface TickPorts {
  observe(): { ok: true; symbol: string } | { ok: false; reason: "rpc" };
  quote(): unknown;
  policy(action: Action): { ok: boolean };
  execute(action: Action, key: string): { ok: true; userOpHash: string } | { ok: false; reason: "paymaster" | "gas" };
  measure(): void;
  probe(key: string): "pending" | "included" | "absent";
}

export function runTick(store: TickStore, agentId: string, tick: number, state: AgentView, ports: TickPorts): TickResult {
  const key = tickKey(agentId, tick);
  const existing = store.get(key);
  if (existing?.status === "recorded") return { action: "none", retry: "none", key };
  if (existing?.status === "submitted") {
    const seen = ports.probe(key);
    if (seen === "pending" || seen === "included") {
      store.put({ ...existing, status: "recorded" });
      return { action: "none", retry: "none", key };
    }
    return { action: "none", retry: "next-tick", key };
  }
  if (!existing) store.put({ key, status: "started" });

  const observed = ports.observe();
  if (!observed.ok) return { action: "none", retry: "next-tick", key };
  if (!acceptTokenField(observed.symbol).ok) return { action: "none", retry: "next-tick", key };
  const rawQuote = ports.quote();
  let quote: Quote | null = null;
  if (rawQuote !== null) {
    const accepted = acceptQuote(rawQuote);
    if (!accepted.ok) return { action: "none", retry: "next-tick", key };
    quote = { provider: accepted.value.provider, price: accepted.value.price };
  }
  const action = propose(state, quote);
  if (!action || action.side === "flat") {
    ports.measure();
    store.put({ key, status: "recorded" });
    return { action: "none", retry: "none", key };
  }
  if (!ports.policy(action).ok) return { action: "none", retry: "next-tick", key };
  const executed = ports.execute(action, key);
  if (!executed.ok) return { action: "none", retry: "next-tick", key };
  store.put({ key, status: "submitted", userOpHash: executed.userOpHash });
  ports.measure();
  store.put({ key, status: "recorded", userOpHash: executed.userOpHash });
  return { action: "executed", retry: "none", key };
}

export class MemoryTickStore implements TickStore {
  private readonly rows = new Map<string, TickRecord>();
  get(key: string): TickRecord | undefined {
    return this.rows.get(key);
  }
  put(record: TickRecord): boolean {
    if (this.rows.has(record.key) && record.status === "started") return false;
    this.rows.set(record.key, record);
    return true;
  }
}
