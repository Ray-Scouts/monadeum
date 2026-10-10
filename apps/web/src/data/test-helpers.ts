import { REALLOCATION_CAP, SLOT_CEILING } from "@monadeum/reallocation/constants";
import type { Agent, Owner } from "./types";

/** Builders for hand-made agents and owners in tests. */
let seq = 0;
export function agent(over: Partial<Agent> = {}): Agent {
  const id = over.id ?? `a${++seq}`;
  return {
    id,
    name: id,
    ownerId: "o",
    status: "active",
    principal: 10,
    capital: 10,
    tradeCount: 30,
    fitnessPercentile: 50,
    lowWindows: 0,
    zeroDownsideFlag: false,
    retirement: null,
    address: "0x0",
    genome: { strategyType: "trading", assetUniverse: ["MON/USDC"], riskTolerance: 0.1, executionFrequency: 5, timeHorizon: 20, informationBudget: 0.02, modelConfiguration: "low", hash: "0x0" },
    capitalHistory: [],
    ...over,
  };
}

export function owner(agents: Agent[], policy: Partial<NonNullable<Owner["policy"]>> | null = {}, id = "o"): Owner {
  return {
    id,
    name: id,
    rootWallet: "0x0",
    policy: policy && {
      agentIds: agents.filter((a) => a.ownerId === id).map((a) => a.id),
      reallocationCap: REALLOCATION_CAP,
      slotCeiling: SLOT_CEILING,
      signedAtEvaluation: 1,
      ...policy,
    },
  };
}
