import type { ApiAgent } from "./types";

/** An agent as the API serves it today, for tests. */
export function apiAgent(over: Partial<ApiAgent> = {}): ApiAgent {
  return {
    id: "ag1",
    name: "alpha",
    ownerId: "u1",
    address: "0x00000000000000000000000000000000000000aa",
    status: null,
    principal: null,
    capital: null,
    tradeCount: null,
    fitnessPercentile: null,
    lowWindows: null,
    zeroDownsideFlag: null,
    retirement: null,
    genome: null,
    capitalHistory: null,
    owner: "0x00000000000000000000000000000000000000bb",
    index: "0",
    registryId: null,
    limits: { perTxCap: "1500000", dailyCap: "5000000" },
    createdAt: 0,
    deployment: "deployed",
    session: { status: "active", keyAddress: "0x00000000000000000000000000000000000000cc", issuedAt: 0, revokedAt: null },
    chain: null,
    ...over,
  };
}
