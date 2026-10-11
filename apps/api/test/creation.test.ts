import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AgentRecord as WorkerAgentRecord, AgentStore } from "@monadeum/agent-registry";
import { hashGenome, normalizeGenome } from "@monadeum/commitment";
import { PgAgentStore } from "@monadeum/db";
import { GENOME_PRESETS } from "@monadeum/strategy/presets";
import { getAddress } from "viem";
import { buildGenome, roleScoped, workerGenome } from "../src/index.js";
import { boot, call, createAgent, newWallet, privySignIn, walletSignIn, type Backend, type Booted } from "./harness.js";

// Agent creation end to end (EVOLUTION.md section 1.1): the genome is built server-side from a preset, hashed with
// libs/commitment, and written with the API's creation record in one transaction. On PGlite every API statement runs
// under `monadeum_api`, and the worker reads the result under `monadeum_worker`, so a missing grant fails here.

/** The worker's view of its registry: on Postgres through the worker's own role, as the worker process reads it. */
function workerStore(b: Booted): AgentStore {
  return b.db ? new PgAgentStore(roleScoped(b.db, "monadeum_worker")) : b.stores.workerAgents;
}

for (const backend of ["memory", "pglite"] as Backend[]) {
  describe(`${backend}: agent creation with a server-built genome`, () => {
    let b: Booted;
    const alice = newWallet();
    const mallory = newWallet();
    let aliceAuth: { cookie: string };
    let malloryAuth: { bearer: string };
    before(async () => {
      b = await boot(backend);
      aliceAuth = { cookie: (await walletSignIn(b.app, alice)).cookie };
      malloryAuth = { bearer: (await privySignIn(b.app, "did:privy:mallory", mallory)).bearer };
    });
    after(() => b.close());

    it("an owner creates an agent; the worker loads it under its own role, and its genome hash verifies", async () => {
      const { agentId, account } = await createAgent(b.app, aliceAuth, alice, "static");
      const worker = await workerStore(b).get(agentId);
      assert.ok(worker, "the worker can load the agent");
      assert.equal(worker.owner, alice.address.toLowerCase());
      assert.equal(getAddress(worker.account), getAddress(account), "the recorded account is the one deployment created");
      assert.equal(worker.status, "active");
      assert.equal(worker.principal, 0n, "principal is 0 until funded");

      // The stored document is the conservative preset on the configured pair, and it hashes to the recorded hash.
      const doc = worker.genomeDocument!;
      assert.ok(doc);
      const preset = GENOME_PRESETS.conservative!;
      assert.deepEqual(doc, normalizeGenome({
        schemaVersion: 1, strategyType: "trading", assetUniverse: ["WETH/USDC"], riskTolerance: preset.riskTolerance,
        executionFrequency: preset.executionFrequency, timeHorizon: preset.timeHorizon, entryThreshold: preset.entryThreshold,
        exitThreshold: preset.exitThreshold, informationSources: [], informationBudget: 0n, modelConfiguration: preset.modelConfiguration,
      }));
      assert.equal(hashGenome(doc), worker.genomeHash);
      assert.equal(buildGenome(preset, "WETH/USDC").hash, worker.genomeHash, "the same preset and pair always commit the same hash");
      assert.deepEqual(worker.genome, workerGenome(doc), "what the worker reads is derived from the committed document");
      assert.equal(worker.genome.pair, "WETH/USDC");

      // The API's creation record names the same owner, and the API serves the committed genome.
      assert.equal((await b.deps.agents.get(agentId))!.owner, alice.address);
      const detail = await call(b.app, "GET", `/agents/${agentId}`, { auth: aliceAuth });
      assert.equal(detail.status, 200);
      assert.equal(detail.body.agent.genome.hash, worker.genomeHash);
      assert.equal(detail.body.agent.genome.preset, "conservative");
      assert.equal(detail.body.agent.genome.informationBudget, "0");
      assert.equal(detail.body.agent.principal, "0");
      assert.equal(detail.body.agent.status, "active");
    });

    it("serves the presets with the pair and the hash each would commit", async () => {
      const res = await call(b.app, "GET", "/genome/presets", { auth: aliceAuth });
      assert.equal(res.status, 200);
      assert.equal(res.body.default, "conservative");
      assert.equal(res.body.pair, "WETH/USDC");
      assert.deepEqual(res.body.presets.map((p: { name: string }) => p.name), ["conservative"]);
      assert.equal(res.body.presets[0].genomeHash, buildGenome(GENOME_PRESETS.conservative!, "WETH/USDC").hash);
      assert.equal((await call(b.app, "GET", "/genome/presets")).status, 401);
    });

    it("refuses any genome field from the client, and an unknown preset, writing nothing", async () => {
      const before = { api: await b.deps.agents.count(), worker: (await workerStore(b).list()).length };
      const base = { name: "inject", perTxCap: "1", dailyCap: "1" };
      for (const extra of [
        { riskTolerance: 0.25 },
        { executionFrequency: 1 },
        { assetUniverse: ["MON/USDC"] },
        { informationBudget: "1000000" },
        { informationSources: ["nansen"] },
        { genome: { riskTolerance: 0.25 } },
        { genomeHash: `0x${"00".repeat(32)}` },
        { principal: "1000000" },
        { status: "active" },
        { owner: mallory.address },
      ]) {
        const res = await call(b.app, "POST", "/agents", { auth: aliceAuth, body: { ...base, ...extra } });
        assert.equal(res.status, 400, JSON.stringify(extra));
        assert.equal(res.body.error, "unknown-field", JSON.stringify(extra));
      }
      for (const preset of ["aggressive", "toString", "constructor", "", 1, null, { name: "conservative" }]) {
        const res = await call(b.app, "POST", "/agents", { auth: aliceAuth, body: { ...base, preset } });
        assert.equal(res.status, 400, JSON.stringify(preset));
        assert.equal(res.body.error, "unknown-preset", JSON.stringify(preset));
      }
      assert.equal(await b.deps.agents.count(), before.api);
      assert.equal((await workerStore(b).list()).length, before.worker);
    });

    it("another user cannot create an agent for an owner wallet they do not own", async () => {
      // Naming alice's wallet is refused outright.
      const named = await call(b.app, "POST", "/agents", { auth: malloryAuth, body: { name: "squat", perTxCap: "1", dailyCap: "1", owner: alice.address } });
      assert.equal(named.status, 400);
      // Without it, the agent belongs to mallory's own owner wallet, never alice's.
      const res = await call(b.app, "POST", "/agents", { auth: malloryAuth, body: { name: "own", perTxCap: "1", dailyCap: "1", preset: "conservative" } });
      assert.equal(res.status, 202);
      const id = res.body.agent.id as string;
      assert.equal((await b.deps.agents.get(id))!.owner, mallory.address);
      assert.equal((await workerStore(b).get(id))!.owner, mallory.address.toLowerCase());
      const aliceAgents = (await call(b.app, "GET", "/agents", { auth: aliceAuth })).body.agents.map((a: { id: string }) => a.id);
      assert.ok(!aliceAgents.includes(id));
      assert.equal((await call(b.app, "GET", `/agents/${id}`, { auth: aliceAuth })).status, 404);
    });

    it("an ownership mismatch between the two records stays refused", async () => {
      const { agentId: id } = await createAgent(b.app, aliceAuth, alice, "mismatch");
      const owning = b.db ? new PgAgentStore(b.db) : b.stores.workerAgents;
      const written = (await owning.get(id))!;
      await owning.update({ ...written, owner: mallory.address });
      for (const [method, url] of [["GET", `/agents/${id}`], ["POST", `/agents/${id}/stop`], ["POST", `/agents/${id}/deploy`]] as const) {
        const res = await call(b.app, method, url, { auth: aliceAuth });
        assert.equal(res.status, 409, url);
        assert.equal(res.body.error, "ownership-mismatch");
      }
      assert.equal((await call(b.app, "GET", `/agents/${id}`, { auth: malloryAuth })).status, 404, "the API's record, not the worker's, grants access");
    });

    it("writes both records or neither", async () => {
      const id = `atomic-${backend}`;
      const document = buildGenome(GENOME_PRESETS.conservative!, "WETH/USDC");
      const worker: WorkerAgentRecord = {
        agentId: id, owner: alice.address.toLowerCase() as `0x${string}`, account: `0x${"ab".repeat(20)}`, genomeHash: document.hash,
        genome: workerGenome(document.document), genomeDocument: document.document, principal: 0n, status: "active",
      };
      // A worker row with this ID already exists (seeded through the owning connection): the second insert fails, and
      // the API's record must not survive it.
      const owning = b.db ? new PgAgentStore(b.db) : b.stores.workerAgents;
      await (owning as unknown as { add(r: WorkerAgentRecord): Promise<void> }).add(worker);
      const record = { agentId: id, owner: alice.address, index: 900n, name: "atomic", preset: "conservative", limits: { perTxCap: 1n, dailyCap: 1n }, registryId: null, createdAt: 1 };
      const outcome = await b.deps.creation.create(record, worker, 50).catch((e: Error) => e);
      assert.ok(outcome instanceof Error || outcome === "conflict", String(outcome));
      assert.equal(await b.deps.agents.get(id), undefined, "the API's record was rolled back or never written");
    });
  });

  describe(`${backend}: population cap`, () => {
    it("refuses creation once the cap of Active agents is reached, writing nothing", async () => {
      const b = await boot(backend, { settings: { populationCap: 1 } });
      try {
        const owner = newWallet();
        const auth = { cookie: (await walletSignIn(b.app, owner)).cookie };
        await createAgent(b.app, auth, owner, "first");
        const res = await call(b.app, "POST", "/agents", { auth, body: { name: "second", perTxCap: "1", dailyCap: "1" } });
        assert.equal(res.status, 409);
        assert.equal(res.body.error, "population-cap");
        assert.equal(await b.deps.agents.count(), 1);
        assert.equal((await workerStore(b).list()).length, 1);
      } finally {
        await b.close();
      }
    });
  });
}
