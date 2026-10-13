import type { AgentRecord as WorkerAgentRecord } from "@monadeum/agent-registry";
import type { Principal } from "@monadeum/auth";
import { REALLOCATION_RECEIVED, REALLOCATION_SENT, chainOrder, projectAccount, type ChainEvent } from "@monadeum/indexer";
import { RECOVERY_WINDOW_MS, RecoveryService, type RecoveryHold } from "@monadeum/recovery";
import { DEFAULT_GENOME_PRESET, GENOME_PRESETS, genomePreset } from "@monadeum/strategy/presets";
import type { OwnerSigner, RevokeResult } from "@monadeum/wallets";
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Address, Hex } from "viem";
import { activityOf, agentView, callerUser, chainView, evaluationsOf, ownedAgent, selectionEvents, spendsOf, x402View } from "./agents.js";
import { API_DEPENDENCIES, fail, type ApiDependencies } from "./dependencies.js";
import { STRATEGY_VERSION_HASH, buildGenome, workerGenome } from "./genome.js";
import { jsonSafe } from "./json.js";
import { Caller, SessionGuard, type ApiReply } from "./session.js";
import type { AgentRecord, StoredHold } from "./stores.js";

const NAME = /^[\p{L}\p{N} ._-]{1,64}$/u;

/** The only fields agent creation reads. Anything else, a genome field above all, is refused, never ignored. */
const CREATE_FIELDS: ReadonlySet<string> = new Set(["name", "perTxCap", "dailyCap", "preset"]);

function capField(body: Record<string, unknown>, key: string, max: bigint): bigint {
  const raw = body[key];
  if (typeof raw !== "string" || !/^[1-9]\d{0,38}$/.test(raw)) fail(400, "invalid-body", `${key} must be a positive integer in base units, as a decimal string`);
  const value = BigInt(raw);
  if (value > max) fail(400, "limit-too-high", `${key} exceeds ${max}`);
  return value;
}

const holdView = (h: StoredHold) => ({ id: h.id, agentIds: h.hold.agentIds, kind: h.hold.kind, requestedAt: h.hold.requestedAt, confirmedAt: h.hold.confirmedAt, released: h.released });

/**
 * AgentsModule over HTTP: the caller's agents read from the API's registry, WalletsModule's record, and the indexer
 * read-model; agent creation, which deploys the account through an owner-signed operation; and the per-agent emergency
 * stop (issue #44), which revokes the session key. Every handler authorizes against the caller's owned agents.
 */
@Controller()
@UseGuards(SessionGuard)
export class AgentsController {
  constructor(
    @Inject(API_DEPENDENCIES) private readonly deps: ApiDependencies,
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
  ) {}

  private wallets() {
    if (!this.deps.wallets) fail(503, "wallets-unavailable", "no chain, bundler, or session key vault is configured for this process");
    return this.deps.wallets;
  }

  /**
   * Population aggregates. Counts, sums, and platform totals only: no other user's agent is identified, and x402 spend
   * is broken down by provider, never by agent. `capital` is the sum, in base units, of the capital of the agents the
   * latest evaluation recorded and did not retire.
   */
  @Get("population")
  async population() {
    const [agents, tracked, deployed, spends, installs, uninstalls, invalidations, cursor, trades, x402, evaluated] = await Promise.all([
      this.deps.agents.count(),
      this.deps.readModel.trackedAccounts(),
      this.deps.readModel.events({ kind: "account.deployed" }),
      this.deps.readModel.events({ kind: "spend.spent" }),
      this.deps.readModel.events({ kind: "kernel.permission-installed" }),
      this.deps.readModel.events({ kind: "kernel.permission-uninstalled" }),
      this.deps.readModel.events({ kind: "kernel.nonce-invalidated" }),
      this.deps.readModel.cursor(),
      this.deps.trades.filledTotal(),
      this.deps.payments.spendTotal(),
      this.deps.evaluations.latest(),
    ]);
    const byAccount = new Map<string, ChainEvent[]>();
    for (const e of [...installs, ...uninstalls, ...invalidations]) {
      if (!e.account) continue;
      byAccount.set(e.account, [...(byAccount.get(e.account) ?? []), e]);
    }
    let liveSessions = 0;
    for (const [account, rows] of byAccount) {
      rows.sort((a, b) => (a.blockNumber !== b.blockNumber ? (a.blockNumber < b.blockNumber ? -1 : 1) : a.logIndex - b.logIndex));
      liveSessions += projectAccount(account as Address, rows).permissions.filter((p) => p.live).length;
    }
    return jsonSafe({
      agents,
      accounts: { tracked: tracked.length, deployed: deployed.length },
      liveSessionKeys: liveSessions,
      totalSpent: spends.reduce((sum, e) => sum + BigInt(e.data.amount as string), 0n),
      cursor: cursor ? { blockNumber: cursor.number, blockHash: cursor.hash } : null,
      trades,
      x402: x402View(x402),
      lastEvaluation: evaluated[0] ? { sequence: evaluated[0].sequence, at: evaluated[0].evaluatedAt } : null,
      capital: evaluated[0] ? evaluated.filter((r) => !r.retired).reduce((sum, r) => sum + r.capital, 0n) : null,
    });
  }

  /** The caller as an owner, in the shape of the web's `Owner`. */
  @Get("owners/me")
  async owner(@Caller() principal: Principal) {
    const user = await callerUser(this.deps, principal);
    const policy = user.ownerWallet ? await this.deps.policies.latest(user.ownerWallet) : undefined;
    return {
      id: user.id,
      name: null,
      rootWallet: user.ownerWallet,
      reallocation: this.deps.settings.reallocation,
      policy: policy
        ? {
            agentIds: policy.document.agentIds,
            reallocationCap: Number(policy.document.capBps) / 10_000,
            slotCeiling: Number(policy.document.slotCeilingBps) / 10_000,
            signedAtEvaluation: null,
            sequence: policy.sequence,
            policyHash: policy.policyHash,
          }
        : null,
    };
  }

  @Get("agents")
  async list(@Caller() principal: Principal) {
    const user = await callerUser(this.deps, principal);
    if (!user.ownerWallet) return { agents: [] };
    const agents = await this.deps.agents.listByOwner(user.ownerWallet);
    const activity = await activityOf(this.deps, agents.map((a) => a.agentId));
    const views = [];
    for (const agent of agents) {
      const wallet = await this.deps.walletStore.get(agent.agentId);
      views.push(agentView(user, agent, wallet, await chainView(this.deps, wallet), await this.deps.workerAgents.get(agent.agentId), activity.get(agent.agentId), await evaluationsOf(this.deps, agent.agentId)));
    }
    return { agents: views };
  }

  @Get("agents/:id")
  async detail(@Param("id") id: string, @Caller() principal: Principal) {
    const { user, agent, wallet, worker } = await ownedAgent(this.deps, principal, id);
    const spends = wallet ? await spendsOf(this.deps, wallet.account) : [];
    const activity = await activityOf(this.deps, [agent.agentId]);
    return {
      agent: agentView(user, agent, wallet, await chainView(this.deps, wallet), worker, activity.get(agent.agentId), await evaluationsOf(this.deps, agent.agentId)),
      spends: jsonSafe(spends.map((e) => ({ amount: e.data.amount, windowTotal: e.data.windowTotal, transactionHash: e.transactionHash, blockNumber: e.blockNumber }))),
    };
  }

  /**
   * The caller's capital flow: each indexed reallocation that moved capital out of or into one of the caller's agents,
   * and each agent's spends. `reallocationsIndexed` is true only when the read-model records the reallocation contract
   * this API is configured with (libs/db migration 0016), so an empty list then means nothing moved; while it is false
   * the list is empty because nothing reads the contract, and says nothing about whether capital moved.
   */
  @Get("capital-flow")
  async capitalFlow(@Caller() principal: Principal) {
    const user = await callerUser(this.deps, principal);
    const configured = this.deps.settings.reallocationContract?.toLowerCase() ?? null;
    const reallocationsIndexed = configured !== null && (await this.deps.readModel.indexedContracts()).reallocation === configured;
    const spends = [];
    const byAccount = new Map<string, string>();
    const moves = new Map<string, ChainEvent>();
    for (const agent of user.ownerWallet ? await this.deps.agents.listByOwner(user.ownerWallet) : []) {
      const wallet = await this.deps.walletStore.get(agent.agentId);
      if (!wallet) continue;
      const account = wallet.account.toLowerCase() as Address;
      byAccount.set(account, agent.agentId);
      for (const e of await spendsOf(this.deps, wallet.account)) {
        spends.push({ agentId: agent.agentId, amount: e.data.amount, transactionHash: e.transactionHash, blockNumber: e.blockNumber });
      }
      if (!reallocationsIndexed) continue;
      // A move between two of the caller's agents is stored once per side; it is served once.
      for (const kind of [REALLOCATION_SENT, REALLOCATION_RECEIVED]) {
        for (const e of await this.deps.readModel.events({ kind, account })) moves.set(`${e.transactionHash}:${e.logIndex}`, e);
      }
    }
    const reallocations = [...moves.values()].sort(chainOrder).map((e) => ({
      evaluation: Number(e.data.evaluation),
      source: e.data.source,
      sink: e.data.sink,
      sourceAgentId: byAccount.get(String(e.data.source)) ?? null,
      sinkAgentId: byAccount.get(String(e.data.sink)) ?? null,
      amount: e.data.amount,
      transactionHash: e.transactionHash,
      blockNumber: e.blockNumber,
    }));
    return jsonSafe({ ownerId: user.id, reallocations, reallocationsIndexed, spends });
  }

  /**
   * The caller's selection events, newest first (`selectionEvents`): retirements and the reallocations the worker
   * submitted, from the evaluation records of the caller's agents, the last `CAPITAL_HISTORY_LIMIT` evaluations of each.
   * Policy-engine decisions are not served here.
   */
  @Get("events")
  async events(@Caller() principal: Principal) {
    const user = await callerUser(this.deps, principal);
    const agents = user.ownerWallet ? await this.deps.agents.listByOwner(user.ownerWallet) : [];
    const records = (await Promise.all(agents.map((a) => evaluationsOf(this.deps, a.agentId)))).flat();
    return jsonSafe({ ownerId: user.id, events: selectionEvents(records) });
  }

  /** The genome presets an owner can create an agent from (EVOLUTION.md section 1.1), with the pair they trade. */
  @Get("genome/presets")
  presets() {
    return jsonSafe({
      default: DEFAULT_GENOME_PRESET,
      pair: this.deps.settings.agentPair,
      presets: Object.values(GENOME_PRESETS).map((p) => ({ ...p, genomeHash: buildGenome(p, this.deps.settings.agentPair).hash })),
    });
  }

  /**
   * Creates an agent and deploys its account with the requested on-chain limits. The owner is the caller's owner
   * wallet, never a request field; the limits are re-validated against the configured maxima. The genome is built
   * here from a named preset and the configured pair, never from the request (EVOLUTION.md section 1.1): a request
   * carrying any field but `name`, `perTxCap`, `dailyCap`, and `preset` is refused. The API's creation record and the
   * worker's agent record, with the genome, its hash, and principal 0, are written together or not at all.
   * Deployment is an owner-signed operation: the response carries the signature request (see OperationsController).
   */
  @Post("agents")
  @HttpCode(202)
  async create(@Body() body: unknown, @Caller() principal: Principal) {
    const wallets = this.wallets();
    if (body === null || typeof body !== "object" || Array.isArray(body)) fail(400, "invalid-body");
    const b = body as Record<string, unknown>;
    for (const key of Object.keys(b)) {
      if (!CREATE_FIELDS.has(key)) fail(400, "unknown-field", `${key.slice(0, 64)} is not a field of agent creation; the genome is built by the server from a preset`);
    }
    if (typeof b.name !== "string" || !NAME.test(b.name)) fail(400, "invalid-body", "name must be 1 to 64 letters, digits, spaces, dots, underscores, or hyphens");
    const preset = genomePreset(b.preset === undefined ? DEFAULT_GENOME_PRESET : b.preset);
    if (!preset) fail(400, "unknown-preset", `preset must be one of: ${Object.keys(GENOME_PRESETS).join(", ")}`);
    const perTxCap = capField(b, "perTxCap", this.deps.settings.maxPerTxCap);
    const dailyCap = capField(b, "dailyCap", this.deps.settings.maxDailyCap);
    if (perTxCap > dailyCap) fail(400, "invalid-body", "perTxCap must not exceed dailyCap");
    const user = await callerUser(this.deps, principal);
    const owner = user.ownerWallet;
    if (!owner) fail(403, "no-owner-wallet");

    const genome = buildGenome(preset, this.deps.settings.agentPair);
    const agentId = this.deps.newId();
    let outcome: "created" | "conflict" | "population-cap" = "conflict";
    let agent: AgentRecord | undefined;
    let worker: WorkerAgentRecord | undefined;
    for (let attempt = 0; attempt < 3 && outcome === "conflict"; attempt++) {
      const index = await this.deps.agents.nextIndex(owner);
      agent = { agentId, owner, index, name: b.name, preset: preset.name, limits: { perTxCap, dailyCap }, registryId: null, createdAt: this.deps.now() };
      worker = {
        agentId,
        owner: owner.toLowerCase() as Address,
        // The counterfactual address deployment will use, so the worker's record names the account from the start.
        account: await wallets.accountAddress(owner, index),
        genomeHash: genome.hash,
        genome: workerGenome(genome.document),
        genomeDocument: genome.document,
        // EVOLUTION.md section 1.1: 0 until funding is recomputed from indexed transfers.
        principal: 0n,
        status: "active",
      };
      outcome = await this.deps.creation.create(agent, worker, this.deps.settings.populationCap);
    }
    if (outcome === "population-cap") fail(409, "population-cap", `agent creation is closed at ${this.deps.settings.populationCap} active agents`);
    if (outcome !== "created") fail(409, "conflict", "agent index taken concurrently; retry");
    const operation = await this.deploy(principal, user.id, agentId, owner, agent!.index, agent!.limits, genome.hash, wallets);
    return { agent: agentView(user, agent!, await this.deps.walletStore.get(agentId), null, worker), operation };
  }

  /** Retries deployment of an agent whose account is not deployed. WalletsModule makes the retry idempotent. */
  @Post("agents/:id/deploy")
  @HttpCode(202)
  async redeploy(@Param("id") id: string, @Caller() principal: Principal) {
    const wallets = this.wallets();
    const { user, owner, agent, wallet, worker } = await ownedAgent(this.deps, principal, id);
    if (wallet?.deployment.status === "deployed") fail(409, "already-deployed");
    if (!worker) fail(409, "no-genome", "the agent has no committed genome record");
    return { operation: await this.deploy(principal, user.id, agent.agentId, owner, agent.index, agent.limits, worker.genomeHash, wallets) };
  }

  /**
   * The owner-signed deployment. With AgentCommitments configured, WalletsModule commits the genome hash and the hash
   * of the strategy version this API runs from the new account in the same operation (ARCHITECTURE.md section 9).
   */
  private deploy(principal: Principal, userId: string, agentId: string, owner: Address, index: bigint, limits: { perTxCap: bigint; dailyCap: bigint }, genomeHash: Hex, wallets: NonNullable<ApiDependencies["wallets"]>) {
    return this.deps.relay.start({
      userId,
      kind: "deploy",
      agentIds: [agentId],
      owner,
      work: async (signer) => {
        await this.authorizeSigner(principal, signer);
        return wallets.deploy({ agentId, owner: signer, index, limits, commitment: { genomeHash, strategyVersionHash: STRATEGY_VERSION_HASH } });
      },
    });
  }

  /**
   * "Activate this agent": issues its session key (ARCHITECTURE.md sections 6 and 10, WalletsModule). Only the owner
   * of a deployed agent can call it. WalletsModule generates the key, holds it in memory only, and asks the owner's
   * wallet, through the relay, to sign Kernel v3.1's EIP-712 enable data for a permission validator scoped to the
   * call allowlist with the spend policy as policy and hook. The response carries that signature request; the owner
   * posts the signature to `POST /operations/:id/signature`. WalletsModule then reads the account's permission state
   * back from chain and keeps the key, in the vault, only if the chain accepts the approval. The result carries that
   * state. Refused while a key is active or its revocation is unverified; a revoked key can be replaced.
   */
  @Post("agents/:id/activate")
  @HttpCode(202)
  async activate(@Param("id") id: string, @Caller() principal: Principal) {
    const wallets = this.wallets();
    const { user, owner, agent, wallet, worker } = await ownedAgent(this.deps, principal, id);
    if (wallet?.deployment.status !== "deployed") fail(409, "not-deployed", "the agent's account is not deployed; deploy it first");
    if (worker?.status === "retired") fail(409, "agent-retired", "a retired agent is not given a new session key");
    if (wallet.session?.status === "active") fail(409, "already-active", "the agent already has an active session key");
    if (wallet.session?.status === "revoking") fail(409, "revocation-pending", "the previous key's revocation is not yet verified on chain; finish the stop first");
    const operation = await this.deps.relay.start({
      userId: user.id,
      kind: "activate",
      agentIds: [agent.agentId],
      owner,
      work: async (signer) => {
        await this.authorizeSigner(principal, signer);
        const result = await wallets.issueSessionKey({ agentId: agent.agentId, owner: signer });
        const session = result.ok ? await wallets.sessionStatus(agent.agentId).catch(() => null) : null;
        return { result, session };
      },
    });
    return { operation };
  }

  /** The session key as WalletsModule and the chain see it, including whether the account accepts it now. */
  @Get("agents/:id/session")
  async session(@Param("id") id: string, @Caller() principal: Principal) {
    const wallets = this.wallets();
    await ownedAgent(this.deps, principal, id);
    const status = await wallets.sessionStatus(id);
    if (!status) fail(404, "no-session");
    return jsonSafe({ agentId: id, ...status });
  }

  /** AuthModule's check that the relaying signer's address is the caller's owner wallet. */
  private async authorizeSigner(principal: Principal, signer: OwnerSigner) {
    const checked = await this.deps.auth.ownerSignerFor(principal, signer);
    if (!checked.ok) throw new Error(`owner signer refused: ${checked.reason}`);
  }

  /**
   * "Stop this agent" (issue #44, THREAT-MODEL.md invariant 8). Only the agent's owner can call it. Revocation is
   * immediate off chain: WalletsModule destroys the session key and marks the record before it asks the owner to sign
   * the on-chain revocation, so by the time this responds the key can no longer sign through the platform. The
   * response carries the owner signature request for the on-chain step and the revocation status read from chain.
   * A request that would put the owner over three distinct agents in 60 minutes is held (SECURITY.md section 9).
   */
  @Post("agents/:id/stop")
  async stop(@Param("id") id: string, @Caller() principal: Principal, @Res({ passthrough: true }) reply: ApiReply & { status(code: number): unknown }) {
    const wallets = this.wallets();
    const { user, owner, wallet } = await ownedAgent(this.deps, principal, id);
    if (!wallet?.session) fail(409, "no-session", "the agent has no session key, so it cannot transact");
    const now = this.deps.now();
    const rootWalletId = owner.toLowerCase();
    const priors = await this.deps.recovery.since(rootWalletId, now - RECOVERY_WINDOW_MS);
    const decision = this.recovery.request({ rootWalletId, agentIds: [id], kind: "revoke", now, priors });
    if (decision.outcome === "hold") {
      const stored: StoredHold = { id: this.deps.newId(), userId: user.id, hold: decision.hold, released: false };
      await this.deps.recovery.putHold(stored);
      reply.status(202);
      return { status: "held", hold: holdView(stored) };
    }
    if (decision.outcome !== "execute") fail(400, "recovery-rejected", decision.outcome === "reject" ? decision.reason : decision.outcome);
    reply.status(200);
    return this.revoke(principal, user.id, owner, decision.agentIds, wallets);
  }

  /** The revocation status read from chain and WalletsModule, which anyone can check against the account's state. */
  @Get("agents/:id/revocation")
  async revocation(@Param("id") id: string, @Caller() principal: Principal) {
    const wallets = this.wallets();
    await ownedAgent(this.deps, principal, id);
    const status = await wallets.revocationStatus(id);
    if (!status) fail(404, "no-session");
    return jsonSafe({ agentId: id, ...status });
  }

  @Get("recovery/holds")
  async holds(@Caller() principal: Principal) {
    const user = await callerUser(this.deps, principal);
    if (!user.ownerWallet) return { holds: [] };
    const holds = await this.deps.recovery.listHolds(user.ownerWallet.toLowerCase());
    return { holds: holds.filter((h) => h.userId === user.id).map(holdView) };
  }

  /** Second confirmation of a held request: the caller restates how many agents it affects, then the delay runs. */
  @Post("recovery/holds/:id/confirm")
  @HttpCode(200)
  async confirmHold(@Param("id") id: string, @Body() body: unknown, @Caller() principal: Principal) {
    const stored = await this.ownHold(principal, id);
    const count = (body as { count?: unknown } | null)?.count;
    if (typeof count !== "number" || !Number.isInteger(count)) fail(400, "invalid-body", "count must be an integer");
    if (stored.hold.confirmedAt !== null) fail(409, "already-confirmed");
    const decision = this.recovery.confirm(stored.hold, count, this.deps.now());
    if (decision.outcome !== "wait") fail(400, "recovery-rejected", decision.outcome === "reject" ? decision.reason : decision.outcome);
    await this.deps.recovery.updateHold({ ...stored, hold: decision.hold });
    return { status: "waiting", readyAt: decision.readyAt, hold: holdView({ ...stored, hold: decision.hold }) };
  }

  /** Executes a confirmed hold once its delay has passed, re-checking that the caller still owns every agent. */
  @Post("recovery/holds/:id/release")
  async releaseHold(@Param("id") id: string, @Caller() principal: Principal, @Res({ passthrough: true }) reply: ApiReply & { status(code: number): unknown }) {
    const wallets = this.wallets();
    const stored = await this.ownHold(principal, id);
    const decision = this.recovery.release(stored.hold, this.deps.now());
    if (decision.outcome === "wait") fail(409, "hold-delay-not-elapsed", String(decision.readyAt));
    if (decision.outcome !== "execute") fail(400, "recovery-rejected", decision.outcome === "reject" ? decision.reason : decision.outcome);
    let owner: Address | null = null;
    let userId = "";
    for (const agentId of decision.agentIds) {
      const owned = await ownedAgent(this.deps, principal, agentId);
      owner = owned.owner;
      userId = owned.user.id;
    }
    await this.deps.recovery.updateHold({ ...stored, released: true });
    reply.status(200);
    return this.revoke(principal, userId, owner!, decision.agentIds, wallets);
  }

  private async ownHold(principal: Principal, id: string): Promise<StoredHold> {
    const user = await callerUser(this.deps, principal);
    const stored = typeof id === "string" && id.length <= 64 ? await this.deps.recovery.getHold(id) : undefined;
    if (!stored || stored.userId !== user.id || !user.ownerWallet || stored.hold.rootWalletId !== user.ownerWallet.toLowerCase()) fail(404, "not-found");
    if (stored.released) fail(409, "already-released");
    return stored as StoredHold & { hold: RecoveryHold };
  }

  /**
   * Revokes each agent's session key in turn, as one owner-signed operation per agent. Each agent is recorded in the
   * recovery log before its revocation starts, because the off-chain revocation takes effect at once.
   */
  private async revoke(principal: Principal, userId: string, owner: Address, agentIds: string[], wallets: NonNullable<ApiDependencies["wallets"]>) {
    const now = this.deps.now();
    for (const agentId of agentIds) await this.deps.recovery.record({ rootWalletId: owner.toLowerCase(), agentId, at: now });
    const operation = await this.deps.relay.start({
      userId,
      kind: "revoke",
      agentIds,
      owner,
      work: async (signer) => {
        await this.authorizeSigner(principal, signer);
        const results: { agentId: string; result: RevokeResult; status: unknown }[] = [];
        for (const agentId of agentIds) {
          const result = await wallets.revokeSessionKey({ agentId, owner: signer });
          const status = await wallets.revocationStatus(agentId).catch(() => null);
          results.push({ agentId, result, status });
        }
        return results;
      },
    });
    const local = [];
    for (const agentId of agentIds) {
      const record = await this.deps.walletStore.get(agentId);
      local.push({ agentId, session: record?.session?.status ?? null, revokedAt: record?.session?.revokedAt ?? null });
    }
    const stopped = operation.status === "succeeded" && Array.isArray(operation.result) && operation.result.every((r: { result: { ok: boolean } }) => r.result.ok);
    return { status: stopped ? "stopped" : operation.status === "failed" ? "failed" : "stopping", local, operation };
  }
}
