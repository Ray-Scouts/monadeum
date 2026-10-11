import type { EvaluationRecord, AgentRecord as WorkerAgentRecord } from "@monadeum/agent-registry";
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
  /** The worker's record: the genome the agent trades under, its principal, and its status. */
  worker: WorkerAgentRecord | undefined;
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
  return { user, owner: own.owner, agent, wallet, worker };
}

/**
 * The committed genome as the API serves it: the normalized document `hash` commits to, with base-unit amounts as
 * decimal strings, and the preset it was built from.
 */
export interface GenomeView {
  strategyType: "trading";
  assetUniverse: string[];
  riskTolerance: number;
  executionFrequency: number;
  timeHorizon: number;
  entryThreshold: number;
  exitThreshold: number;
  informationSources: string[];
  informationBudget: string;
  modelConfiguration: string;
  hash: string;
  preset: string | null;
}

/**
 * One agent as the API serves it. The first group of fields carries the names of `Agent` in
 * `apps/web/src/data/types.ts`, so the web's data source can switch to the API field by field; a field no service
 * produces yet is null rather than invented. `status`, `principal`, and `genome` come from the worker's record, which
 * agent creation writes: `principal` is in settlement-asset base units as a decimal string, not the web's dollars. The
 * evaluation fields (`capital`, `fitnessPercentile`, `lowWindows`, `zeroDownsideFlag`, `retirement`, `capitalHistory`)
 * come from the worker's evaluation records: the latest one, and up to `CAPITAL_HISTORY_LIMIT` for the history, base
 * units as decimal strings; all null before the worker has evaluated the agent. The second group is what the API can
 * actually source today: its own registry, WalletsModule's record, and the indexer's read-model of the account.
 */
export interface AgentView {
  id: string;
  name: string;
  ownerId: string;
  address: string | null;
  status: "active" | "retired" | null;
  principal: string | null;
  capital: string | null;
  tradeCount: null;
  /** Within the niche, 0 to 100, as the web's `Agent` type has it; the evaluation record stores it in [0, 1]. */
  fitnessPercentile: number | null;
  lowWindows: number | null;
  zeroDownsideFlag: boolean | null;
  retirement: { rule: string; evaluation: number } | null;
  genome: GenomeView | null;
  capitalHistory: { evaluation: number; capital: string }[] | null;

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

function genomeView(agent: AgentRecord, worker: WorkerAgentRecord | undefined): GenomeView | null {
  const doc = worker?.genomeDocument;
  if (!worker || !doc) return null;
  return {
    strategyType: doc.strategyType,
    assetUniverse: [...doc.assetUniverse],
    riskTolerance: doc.riskTolerance,
    executionFrequency: doc.executionFrequency,
    timeHorizon: doc.timeHorizon,
    entryThreshold: doc.entryThreshold,
    exitThreshold: doc.exitThreshold,
    informationSources: [...doc.informationSources],
    informationBudget: doc.informationBudget.toString(),
    modelConfiguration: doc.modelConfiguration,
    hash: worker.genomeHash,
    preset: agent.preset,
  };
}

/** How many of an agent's most recent evaluations `capitalHistory` carries. */
export const CAPITAL_HISTORY_LIMIT = 50;

/**
 * `history` is the agent's most recent evaluation records, oldest first. A retired agent is never evaluated again, so
 * the record that retired it is its latest.
 */
export function agentView(
  user: UserRecord,
  agent: AgentRecord,
  wallet: AgentWalletRecord | undefined,
  chain: AccountView | null,
  worker: WorkerAgentRecord | undefined,
  history: readonly EvaluationRecord[] = [],
): AgentView {
  const latest = history.at(-1);
  return {
    id: agent.agentId,
    name: agent.name,
    ownerId: user.id,
    address: wallet?.account ?? null,
    status: worker?.status ?? null,
    principal: worker ? worker.principal.toString() : null,
    capital: latest ? latest.capital.toString() : null,
    tradeCount: null,
    // Stored in [0, 1], as the retirement check computes it; served on the web's 0 to 100 scale.
    fitnessPercentile: latest && latest.fitnessPercentile !== null ? latest.fitnessPercentile * 100 : null,
    lowWindows: latest?.lowWindows ?? null,
    zeroDownsideFlag: latest?.zeroDownsideFlag ?? null,
    retirement: latest?.retired && latest.retirementRule ? { rule: latest.retirementRule, evaluation: latest.sequence } : null,
    genome: genomeView(agent, worker),
    capitalHistory: latest ? history.map((r) => ({ evaluation: r.sequence, capital: r.capital.toString() })) : null,
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

/** The agent's most recent evaluation records, oldest first. Call only for an agent the caller owns. */
export function evaluationsOf(deps: ApiDependencies, agentId: string): Promise<EvaluationRecord[]> {
  return deps.evaluations.history(agentId, CAPITAL_HISTORY_LIMIT);
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
