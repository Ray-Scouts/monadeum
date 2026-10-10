import type { Principal, UserRecord } from "@monadeum/auth";
import { projectAccount, type AccountView, type ChainEvent } from "@monadeum/indexer";
import type { AgentWalletRecord } from "@monadeum/wallets";
import { getAddress, isAddressEqual, type Address } from "viem";
import { fail, type ApiDependencies } from "./dependencies.js";
import { jsonSafe } from "./json.js";
import { authStatus } from "./session.js";
import type { AgentRecord } from "./stores.js";

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The caller's user record. */
export async function callerUser(deps: ApiDependencies, principal: Principal): Promise<UserRecord> {
  const user = await deps.auth.user(principal);
  if ("ok" in user) fail(authStatus(user.reason), user.reason);
  return user;
}

export interface OwnedAgent {
  user: UserRecord;
  /** The caller's owner wallet, which owns the agent. */
  owner: Address;
  agent: AgentRecord;
  wallet: AgentWalletRecord | undefined;
}

/**
 * Authorization for every per-agent request (THREAT-MODEL.md trust boundary 10). The agent's owner is read from the
 * API's own registry, never from the request, and compared with the caller's one owner wallet by AuthModule. An
 * agent the caller does not own answers exactly like an agent that does not exist, so its existence is not
 * disclosed. WalletsModule's record and the worker's agent registry, where they exist, must name the same owner; a
 * disagreement fails closed.
 */
export async function ownedAgent(deps: ApiDependencies, principal: Principal, agentId: string): Promise<OwnedAgent> {
  if (typeof agentId !== "string" || !AGENT_ID.test(agentId)) fail(404, "not-found");
  const user = await callerUser(deps, principal);
  const agent = await deps.agents.get(agentId);
  if (!agent) fail(404, "not-found");
  const own = await deps.auth.checkOwnership(principal, agent.owner);
  if (!own.ok) {
    if (own.reason === "not-owner" || own.reason === "no-owner-wallet") fail(404, "not-found");
    fail(authStatus(own.reason), own.reason);
  }
  const wallet = await deps.walletStore.get(agentId);
  if (wallet && !isAddressEqual(wallet.owner, agent.owner)) fail(409, "ownership-mismatch");
  // The worker's registry is the record the agent trades under; once it exists it must name the same owner.
  const worker = await deps.workerAgents.get(agentId);
  if (worker && !isAddressEqual(worker.owner, agent.owner)) fail(409, "ownership-mismatch");
  return { user, owner: own.owner, agent, wallet };
}

/**
 * One agent as the API serves it. The first group of fields carries the names of `Agent` in
 * `apps/web/src/data/types.ts`, so the web's data source can switch to the API field by field; a field no service
 * produces yet is null rather than invented. The second group is what the API can actually source today: its own
 * registry, WalletsModule's record, and the indexer's read-model of the account.
 */
export interface AgentView {
  id: string;
  name: string;
  ownerId: string;
  address: string | null;
  status: null;
  principal: null;
  capital: null;
  tradeCount: null;
  fitnessPercentile: null;
  lowWindows: null;
  zeroDownsideFlag: null;
  retirement: null;
  genome: null;
  capitalHistory: null;

  owner: Address;
  index: string;
  registryId: string | null;
  limits: { perTxCap: string; dailyCap: string };
  createdAt: number;
  deployment: "not-started" | "pending" | "deployed";
  /** WalletsModule's off-chain record. The on-chain answer is `GET /agents/:id/revocation`. */
  session: { status: "active" | "revoking" | "revoked"; keyAddress: string; issuedAt: number; revokedAt: number | null } | null;
  /** The account as the indexer has it, up to its cursor. Null before the account has an address. */
  chain: unknown;
}

export function agentView(user: UserRecord, agent: AgentRecord, wallet: AgentWalletRecord | undefined, chain: AccountView | null): AgentView {
  return {
    id: agent.agentId,
    name: agent.name,
    ownerId: user.id,
    address: wallet?.account ?? null,
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
    owner: getAddress(agent.owner),
    index: agent.index.toString(),
    registryId: agent.registryId,
    limits: { perTxCap: agent.limits.perTxCap.toString(), dailyCap: agent.limits.dailyCap.toString() },
    createdAt: agent.createdAt,
    deployment: wallet ? wallet.deployment.status : "not-started",
    session: wallet?.session
      ? { status: wallet.session.status, keyAddress: wallet.session.keyAddress, issuedAt: wallet.session.issuedAt, revokedAt: wallet.session.revokedAt }
      : null,
    chain: chain ? jsonSafe(chain) : null,
  };
}

/** The read-model's view of the agent's account, or null when it has no account address yet. */
export async function chainView(deps: ApiDependencies, wallet: AgentWalletRecord | undefined): Promise<AccountView | null> {
  if (!wallet) return null;
  const rows = await deps.readModel.events({ account: wallet.account.toLowerCase() as Address });
  return projectAccount(wallet.account, rows);
}

/** Every indexed `Spent` event of the account, oldest first. */
export async function spendsOf(deps: ApiDependencies, account: Address): Promise<ChainEvent[]> {
  return deps.readModel.events({ kind: "spend.spent", account: account.toLowerCase() as Address });
}
