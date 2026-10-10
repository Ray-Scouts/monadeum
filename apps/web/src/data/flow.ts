import { round6 } from "./evaluate";
import type { Agent, Reallocation } from "./types";

export interface FlowRow {
  agent: Agent;
  /** Net change from reallocation at each evaluation, `first` to `last`; positive is received. */
  net: number[];
  total: number;
}

/** One owner's agents against the evaluations: what reallocation moved into or out of each, at each evaluation. */
export function flowMatrix(agents: Agent[], moves: Reallocation[], first: number, last: number): FlowRow[] {
  return agents.map((agent) => {
    const net = Array.from({ length: last - first + 1 }, (_, i) =>
      round6(
        moves
          .filter((m) => m.evaluation === first + i)
          .reduce((s, m) => s + (m.sinkId === agent.id ? m.amount : 0) - (m.sourceId === agent.id ? m.amount : 0), 0),
      ),
    );
    return { agent, net, total: round6(net.reduce((s, v) => s + v, 0)) };
  });
}
