import type { Agent } from "@/data/types";

export const usd = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
export const agentLabel = (a: Pick<Agent, "name" | "id">) => `${a.name}·${a.id}`;
export const shortAddress = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
export const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;
