import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MemoryAgentStore } from "@monadeum/agent-registry";
import { PgAgentStore } from "@monadeum/db";
import { hashReallocationPolicy } from "@monadeum/commitment";
import { REALLOCATION_DISABLED, REALLOCATION_OFF_REASON } from "@monadeum/reallocation/switch";
import { RECOVERY_DELAY_MS } from "@monadeum/recovery";
import { accessToken, boot, call, createAgent, index, issueKey, newWallet, ORIGIN, privySignIn, settings, signRequest, signThrough, walletSignIn, type Backend, type Booted } from "./harness.js";

// End-to-end: the Nest application on Fastify, driven through HTTP injection, over WalletsModule's test chain. Every
// suite runs twice, on the in-memory stores and on Postgres (PGlite, in process) with the API's statements running
// under the `monadeum_api` and `monadeum_reader` roles of migrations 0004 and 0007, so a missing grant fails here.

for (const backend of ["memory", "pglite"] as Backend[]) {
  describe(`${backend}: authentication`, () => {
    let b: Booted;
    before(async () => (b = await boot(backend)));
    after(() => b.close());

    it("signs in with an external wallet, sets an HttpOnly Secure SameSite=Strict cookie, and never returns the token", async () => {
      const account = newWallet();
      const challenge = await call(b.app, "POST", "/auth/wallet/challenge", { body: { address: account.address } });
      assert.equal(challenge.status, 200);
      assert.match(challenge.body.message, /does not authorize any transaction/);
      const signature = await account.signMessage({ message: challenge.body.message });
      const verified = await call(b.app, "POST", "/auth/wallet/verify", { body: { nonce: challenge.body.nonce, signature } });
      assert.equal(verified.status, 200);
      const cookie = String(verified.headers["set-cookie"]);
      assert.match(cookie, /^monadeum_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600$/);
      const token = /monadeum_session=([^;]+)/.exec(cookie)![1]!;
      assert.ok(!JSON.stringify(verified.body).includes(token), "the session token is never in a response body");
      assert.equal(verified.body.user.ownerWallet, account.address);

      const me = await call(b.app, "GET", "/auth/me", { auth: { cookie: token } });
      assert.equal(me.status, 200);
      assert.equal(me.body.user.id, verified.body.user.id);
      assert.equal(me.body.via, "wallet");

      // The challenge is spent by its first use.
      const replay = await call(b.app, "POST", "/auth/wallet/verify", { body: { nonce: challenge.body.nonce, signature } });
      assert.equal(replay.status, 401);
      assert.equal(replay.body.error, "invalid-challenge");
    });

    it("refuses a signature from another wallet, a malformed address, and missing credentials", async () => {
      const account = newWallet();
      const challenge = await call(b.app, "POST", "/auth/wallet/challenge", { body: { address: account.address } });
      const signature = await newWallet().signMessage({ message: challenge.body.message });
      const res = await call(b.app, "POST", "/auth/wallet/verify", { body: { nonce: challenge.body.nonce, signature } });
      assert.equal(res.status, 401);
      assert.equal(res.body.error, "bad-signature");
      assert.equal((await call(b.app, "POST", "/auth/wallet/challenge", { body: { address: "0x1234" } })).status, 400);
      assert.equal((await call(b.app, "POST", "/auth/wallet/challenge", { body: {} })).status, 400);
      const anonymous = await call(b.app, "GET", "/auth/me");
      assert.equal(anonymous.status, 401);
      assert.equal(anonymous.body.error, "unauthenticated");
      assert.equal((await call(b.app, "GET", "/auth/me", { auth: { cookie: "forged" } })).status, 401);
    });

    it("signs in through Privy and authenticates each request with the access token", async () => {
      const embedded = newWallet();
      const { bearer, userId } = await privySignIn(b.app, "did:privy:alice", embedded);
      const me = await call(b.app, "GET", "/auth/me", { auth: { bearer } });
      assert.equal(me.status, 200);
      assert.equal(me.body.user.id, userId);
      assert.equal(me.body.user.ownerWallet, embedded.address);
      assert.equal(me.body.via, "privy");
      assert.equal((await call(b.app, "GET", "/auth/me", { auth: { bearer: accessToken("did:privy:nobody") } })).status, 401);
      assert.equal((await call(b.app, "GET", "/auth/me", { auth: { bearer: "not-a-token" } })).status, 401);
    });

    it("refuses Privy guests and a request that carries both credentials", async () => {
      const guest = await call(b.app, "POST", "/auth/privy/sign-in", { body: { accessToken: accessToken("did:privy:guest"), identityToken: `identity:did:privy:guest:${newWallet().address}:guest` } });
      assert.equal(guest.status, 403);
      assert.equal(guest.body.error, "guest-not-supported");
      const { bearer } = await privySignIn(b.app, "did:privy:bob", newWallet());
      const { cookie } = await walletSignIn(b.app, newWallet());
      const both = await call(b.app, "GET", "/auth/me", { auth: { bearer, cookie } });
      assert.equal(both.status, 401);
      assert.equal(both.body.error, "ambiguous-credentials");
    });

    it("refuses a cookie-authenticated state change from another origin or without one", async () => {
      const { cookie } = await walletSignIn(b.app, newWallet());
      for (const origin of [null, "https://evil.example"]) {
        const res = await call(b.app, "POST", "/agents", { auth: { cookie }, origin, body: { name: "x", perTxCap: "1", dailyCap: "1" } });
        assert.equal(res.status, 403);
        assert.equal(res.body.error, "origin-not-allowed");
      }
      const login = await call(b.app, "POST", "/auth/wallet/verify", { origin: "https://evil.example", body: { nonce: "n", signature: "0x00" } });
      assert.equal(login.status, 403);
      // A read needs no Origin.
      assert.equal((await call(b.app, "GET", "/agents", { auth: { cookie } })).status, 200);
    });

    it("links an external wallet to a Privy user, and that wallet then signs in as the same user", async () => {
      const { bearer, userId } = await privySignIn(b.app, "did:privy:carol", newWallet());
      const external = newWallet();
      const challenge = await call(b.app, "POST", "/auth/wallet/link/challenge", { auth: { bearer }, body: { address: external.address } });
      assert.equal(challenge.status, 200);
      const signature = await external.signMessage({ message: challenge.body.message });
      const linked = await call(b.app, "POST", "/auth/wallet/link", { auth: { bearer }, body: { nonce: challenge.body.nonce, signature } });
      assert.equal(linked.status, 200);
      assert.equal(linked.body.user.wallets.length, 2);
      const again = await walletSignIn(b.app, external);
      assert.equal(again.userId, userId);
      // Linking never changes the owner wallet.
      assert.notEqual(linked.body.user.ownerWallet, external.address);
    });

    it("signs out: the cookie is cleared and the session no longer authenticates", async () => {
      const { cookie } = await walletSignIn(b.app, newWallet());
      const out = await call(b.app, "POST", "/auth/sign-out", { auth: { cookie } });
      assert.equal(out.status, 200);
      assert.match(String(out.headers["set-cookie"]), /Max-Age=0/);
      assert.equal((await call(b.app, "GET", "/auth/me", { auth: { cookie } })).status, 401);
    });
  });

  describe(`${backend}: rate limiting`, () => {
    let b: Booted;
    before(async () => (b = await boot(backend, { settings: { authRateLimit: 3 } })));
    after(() => b.close());

    it("limits challenge and sign-in requests per client and endpoint, and leaves other endpoints alone", async () => {
      const address = newWallet().address;
      for (let i = 0; i < 3; i++) assert.equal((await call(b.app, "POST", "/auth/wallet/challenge", { body: { address } })).status, 200);
      const limited = await call(b.app, "POST", "/auth/wallet/challenge", { body: { address } });
      assert.equal(limited.status, 429);
      for (let i = 0; i < 3; i++) assert.equal((await call(b.app, "POST", "/auth/privy/sign-in", { body: { accessToken: "a", identityToken: "b" } })).status, 401);
      assert.equal((await call(b.app, "POST", "/auth/privy/sign-in", { body: { accessToken: "a", identityToken: "b" } })).status, 429);
      // Not throttled: reads and sign-out.
      for (let i = 0; i < 5; i++) assert.equal((await call(b.app, "GET", "/auth/me")).status, 401);
      assert.equal((await call(b.app, "POST", "/auth/sign-out")).status, 200);
    });
  });

  describe(`${backend}: agents and ownership`, () => {
    let b: Booted;
    const alice = newWallet();
    const mallory = newWallet();
    let aliceAuth: { cookie: string };
    let malloryAuth: { bearer: string };
    let agentId: string;
    let account: `0x${string}`;
    before(async () => {
      b = await boot(backend);
      aliceAuth = { cookie: (await walletSignIn(b.app, alice)).cookie };
      malloryAuth = { bearer: (await privySignIn(b.app, "did:privy:mallory", mallory)).bearer };
      ({ agentId, account } = await createAgent(b.app, aliceAuth, alice));
      await issueKey(b, agentId, alice);
      await index(b, account, [
        { kind: "account.deployed", data: { factory: "0x00000000000000000000000000000000000000fa", paymaster: "0x00000000000000000000000000000000000000fb" } },
        { kind: "spend.limits-set", data: { perTxCap: "1000000", dailyCap: "5000000" } },
        { kind: "spend.spent", data: { amount: "250000", windowTotal: "250000" } },
      ]);
    });
    after(() => b.close());

    it("deploys through an owner-signed operation: the API returns a signature request and holds no key", async () => {
      const res = await call(b.app, "POST", "/agents", { auth: aliceAuth, body: { name: "beta", perTxCap: "10", dailyCap: "20" } });
      assert.equal(res.status, 202);
      const op = res.body.operation;
      assert.equal(op.status, "awaiting-signature");
      assert.equal(op.kind, "deploy");
      assert.equal(op.owner, alice.address);
      assert.equal(op.signatureRequest.kind, "message");
      assert.match(op.signatureRequest.message.raw, /^0x[0-9a-f]{64}$/);
      // Nothing is deployed until the owner signs.
      assert.equal((await call(b.app, "GET", `/agents/${res.body.agent.id}`, { auth: aliceAuth })).body.agent.deployment, "pending");
      const done = await signThrough(b.app, aliceAuth, op, alice);
      assert.equal(done.status, "succeeded");
      assert.equal(done.result.ok, true);
      assert.equal(done.result.created, true);
    });

    it("lists the owner's agents with the read-model's view of each account", async () => {
      const res = await call(b.app, "GET", "/agents", { auth: aliceAuth });
      assert.equal(res.status, 200);
      const mine = res.body.agents.find((a: { id: string }) => a.id === agentId);
      assert.equal(mine.address, account);
      assert.equal(mine.deployment, "deployed");
      assert.equal(mine.session.status, "active");
      assert.equal(mine.chain.limits.perTxCap, "1000000");
      assert.equal(mine.chain.totalSpent, "250000");
      // Fields of the web's Agent that no service produces yet are null, not invented.
      assert.equal(mine.capital, null);
      assert.equal(mine.fitnessPercentile, null);
    });

    it("serves detail and capital flow to the owner only", async () => {
      const detail = await call(b.app, "GET", `/agents/${agentId}`, { auth: aliceAuth });
      assert.equal(detail.status, 200);
      assert.deepEqual(detail.body.spends.map((s: { amount: string }) => s.amount), ["250000"]);
      const flow = await call(b.app, "GET", "/capital-flow", { auth: aliceAuth });
      assert.equal(flow.body.reallocationsIndexed, false);
      assert.deepEqual(flow.body.reallocations, []);
      assert.equal(flow.body.spends.length, 1);

      const other = await call(b.app, "GET", `/agents/${agentId}`, { auth: malloryAuth });
      assert.equal(other.status, 404, "another user's agent answers like a missing one");
      assert.equal(other.body.error, "not-found");
      assert.equal((await call(b.app, "GET", `/agents/${agentId}/revocation`, { auth: malloryAuth })).status, 404);
      assert.deepEqual((await call(b.app, "GET", "/agents", { auth: malloryAuth })).body.agents, []);
      assert.deepEqual((await call(b.app, "GET", "/capital-flow", { auth: malloryAuth })).body.spends, []);
      assert.equal((await call(b.app, "GET", "/agents/no-such-agent", { auth: aliceAuth })).status, 404);
      assert.equal((await call(b.app, "GET", `/agents/${agentId}`)).status, 401);
    });

    it("refuses to stop, redeploy, or sign for another user's agent", async () => {
      const stop = await call(b.app, "POST", `/agents/${agentId}/stop`, { auth: malloryAuth });
      assert.equal(stop.status, 404);
      assert.equal((await call(b.app, "POST", `/agents/${agentId}/deploy`, { auth: malloryAuth })).status, 404);
      const record = await b.stores.walletStore.get(agentId);
      assert.equal(record!.session!.status, "active", "the agent was not touched");
      assert.ok(await b.vault.get(agentId), "its key still exists");

      // An operation is visible, and signable, only by the user who started it.
      const started = await call(b.app, "POST", "/agents", { auth: aliceAuth, body: { name: "gamma", perTxCap: "1", dailyCap: "1" } });
      const op = started.body.operation;
      assert.equal((await call(b.app, "GET", `/operations/${op.id}`, { auth: malloryAuth })).status, 404);
      const forged = await call(b.app, "POST", `/operations/${op.id}/signature`, { auth: malloryAuth, body: { requestId: op.signatureRequest.id, signature: await signRequest(mallory, op.signatureRequest) } });
      assert.equal(forged.status, 404);
      // A signature from any key but the owner's is refused, and the request stays open for the owner.
      const wrong = await call(b.app, "POST", `/operations/${op.id}/signature`, { auth: aliceAuth, body: { requestId: op.signatureRequest.id, signature: await signRequest(mallory, op.signatureRequest) } });
      assert.equal(wrong.status, 400);
      assert.equal(wrong.body.error, "bad-signature");
      assert.equal((await signThrough(b.app, aliceAuth, op, alice)).status, "succeeded");
    });

    it("fails closed when the worker's agent registry names a different owner", async () => {
      const { agentId: id } = await createAgent(b.app, aliceAuth, alice, "contested");
      // Creation wrote the worker's record with alice as owner; rewrite it to name mallory, through the owning
      // connection on Postgres (the API's role cannot update it).
      const store = b.db ? new PgAgentStore(b.db) : (b.stores.workerAgents as MemoryAgentStore);
      const written = (await store.get(id))!;
      assert.equal(written.owner, alice.address.toLowerCase());
      await store.update({ ...written, owner: mallory.address });
      for (const [method, url] of [["GET", `/agents/${id}`], ["POST", `/agents/${id}/stop`]] as const) {
        const res = await call(b.app, method, url, { auth: aliceAuth });
        assert.equal(res.status, 409, url);
        assert.equal(res.body.error, "ownership-mismatch");
      }
      assert.equal((await call(b.app, "GET", `/agents/${id}`, { auth: malloryAuth })).status, 404, "the API's record, not the worker's, grants access");
    });

    it("re-validates the requested limits and requires an owner wallet", async () => {
      const over = await call(b.app, "POST", "/agents", { auth: aliceAuth, body: { name: "big", perTxCap: "1000000001", dailyCap: "5000000000" } });
      assert.equal(over.status, 400);
      assert.equal(over.body.error, "limit-too-high");
      assert.equal((await call(b.app, "POST", "/agents", { auth: aliceAuth, body: { name: "inverted", perTxCap: "20", dailyCap: "10" } })).status, 400);
      assert.equal((await call(b.app, "POST", "/agents", { auth: aliceAuth, body: { name: "neg", perTxCap: "-1", dailyCap: "10" } })).status, 400);
      assert.equal((await call(b.app, "POST", "/agents", { auth: aliceAuth, body: { name: "", perTxCap: "1", dailyCap: "1" } })).status, 400);
      assert.equal((await call(b.app, "POST", "/agents", { body: { name: "anon", perTxCap: "1", dailyCap: "1" } })).status, 401);
    });

    it("reports population aggregates without identifying other users' agents", async () => {
      const res = await call(b.app, "GET", "/population", { auth: malloryAuth });
      assert.equal(res.status, 200);
      assert.ok(res.body.agents >= 1);
      assert.equal(res.body.accounts.deployed, 1);
      assert.equal(res.body.totalSpent, "250000");
      assert.ok(!JSON.stringify(res.body).includes(agentId));
      assert.ok(!JSON.stringify(res.body).toLowerCase().includes(account.toLowerCase()));
    });
  });

  describe(`${backend}: stop this agent`, () => {
    let b: Booted;
    const owner = newWallet();
    let auth: { bearer: string };
    before(async () => {
      b = await boot(backend);
      auth = { bearer: (await privySignIn(b.app, "did:privy:dana", owner)).bearer };
    });
    after(() => b.close());

    it("revokes off chain at once, then on chain once the owner signs, and returns the verifiable status", async () => {
      const { agentId } = await createAgent(b.app, auth, owner);
      await issueKey(b, agentId, owner);
      const res = await call(b.app, "POST", `/agents/${agentId}/stop`, { auth });
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "stopping");
      assert.equal(res.body.operation.status, "awaiting-signature");
      assert.equal(res.body.operation.kind, "revoke");
      // Already effective off chain: the key is gone and the record is marked, before the owner signs anything.
      assert.deepEqual(res.body.local.map((l: { session: string }) => l.session), ["revoking"]);
      assert.equal(await b.vault.get(agentId), null);
      assert.equal((await b.stores.walletStore.get(agentId))!.session!.status, "revoking");

      const done = await signThrough(b.app, auth, res.body.operation, owner);
      assert.equal(done.status, "succeeded");
      const [outcome] = done.result;
      assert.equal(outcome.result.ok, true);
      assert.equal(outcome.result.onChain, "verified");
      assert.match(outcome.result.operation.userOpHash, /^0x[0-9a-f]{64}$/);
      assert.equal(outcome.status.revoked, true);
      assert.equal(outcome.status.keyDestroyed, true);
      assert.deepEqual(await b.deps.wallets!.execute({ agentId, calls: [] }), { ok: false, reason: "revoked" });

      const status = await call(b.app, "GET", `/agents/${agentId}/revocation`, { auth });
      assert.equal(status.status, 200);
      assert.equal(status.body.revoked, true);
      assert.ok(status.body.state.currentNonce > status.body.enableNonce, "the Kernel nonce moved past the enable signature's");
      assert.equal((await call(b.app, "GET", `/agents/${agentId}`, { auth })).body.agent.session.status, "revoked");
    });

    it("answers 409 for an agent with no session key", async () => {
      const { agentId } = await createAgent(b.app, auth, owner, "keyless");
      const res = await call(b.app, "POST", `/agents/${agentId}/stop`, { auth });
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "no-session");
    });

    it("holds the fourth distinct agent inside an hour, and releases it after confirmation and the delay", async () => {
      const agents: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { agentId } = await createAgent(b.app, auth, owner, `fleet-${i}`);
        await issueKey(b, agentId, owner);
        agents.push(agentId);
      }
      // The first test already stopped one agent in this window, so two more execute and the next is held.
      for (const agentId of agents.slice(0, 2)) {
        const res = await call(b.app, "POST", `/agents/${agentId}/stop`, { auth });
        assert.equal(res.body.status, "stopping");
        assert.equal((await signThrough(b.app, auth, res.body.operation, owner)).status, "succeeded");
      }
      const held = await call(b.app, "POST", `/agents/${agents[2]}/stop`, { auth });
      assert.equal(held.status, 202);
      assert.equal(held.body.status, "held");
      assert.ok(await b.vault.get(agents[2]!), "a held stop does not execute");
      const holdId = held.body.hold.id;
      assert.equal((await call(b.app, "GET", "/recovery/holds", { auth })).body.holds.length, 1);

      assert.equal((await call(b.app, "POST", `/recovery/holds/${holdId}/confirm`, { auth, body: { count: 2 } })).status, 400);
      const confirmed = await call(b.app, "POST", `/recovery/holds/${holdId}/confirm`, { auth, body: { count: 1 } });
      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.body.status, "waiting");
      const early = await call(b.app, "POST", `/recovery/holds/${holdId}/release`, { auth });
      assert.equal(early.status, 409);
      assert.equal(early.body.error, "hold-delay-not-elapsed");

      b.clock.now += RECOVERY_DELAY_MS;
      const released = await call(b.app, "POST", `/recovery/holds/${holdId}/release`, { auth });
      assert.equal(released.status, 200);
      const done = await signThrough(b.app, auth, released.body.operation, owner);
      assert.equal(done.status, "succeeded");
      assert.equal(done.result[0].status.revoked, true);
      assert.equal((await call(b.app, "POST", `/recovery/holds/${holdId}/release`, { auth })).status, 409);
    });

    it("answers 503 for deployment and stop when no WalletsModule is configured", async () => {
      const bare = await boot(backend, { wallets: false });
      try {
        const { cookie } = await walletSignIn(bare.app, owner);
        const res = await call(bare.app, "POST", "/agents", { auth: { cookie }, body: { name: "x", perTxCap: "1", dailyCap: "1" } });
        assert.equal(res.status, 503);
        assert.equal(res.body.error, "wallets-unavailable");
      } finally {
        await bare.close();
      }
    });
  });

  describe(`${backend}: owner-signed reallocation policy`, () => {
    let b: Booted;
    const owner = newWallet();
    const commits: unknown[] = [];
    let auth: { cookie: string };
    let userOwner: `0x${string}`;
    before(async () => {
      b = await boot(backend, { policyWriter: { commitPolicy: async (c) => (commits.push(c), { txHash: `0x${"ab".repeat(32)}` }) } });
      auth = { cookie: (await walletSignIn(b.app, owner)).cookie };
      userOwner = owner.address;
    });
    after(() => b.close());

    const register = async (agentId: string, by = userOwner) => {
      assert.ok(await b.deps.agents.create({ agentId, owner: by, index: await b.deps.agents.nextIndex(by), name: agentId, preset: null, limits: { perTxCap: 1n, dailyCap: 1n }, registryId: null, createdAt: Date.now() }));
    };
    // The agent's smart account address, as WalletsModule records it.
    const giveAccount = async (agentId: string, account: `0x${string}`, by = userOwner) => {
      assert.ok(await b.stores.walletStore.claim({ agentId, owner: by, index: 0n, account, deployment: { status: "deployed", userOpHash: null }, session: null }));
    };
    const ACCOUNT_1 = "0x0000000000000000000000000000000000000a01" as const;
    const ACCOUNT_2 = "0x0000000000000000000000000000000000000A02" as const;

    it("refuses agents without an account, other users' agents, and bounds that loosen the protocol", async () => {
      await register("no-account-1");
      await register("no-account-2");
      const res = await call(b.app, "POST", "/policies/reallocation", { auth, body: { agentIds: ["no-account-1", "no-account-2"] } });
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "agent-has-no-account");
      await register("registered-1");
      await giveAccount("registered-1", ACCOUNT_1);
      await register("foreign", newWallet().address);
      assert.equal((await call(b.app, "POST", "/policies/reallocation", { auth, body: { agentIds: ["registered-1", "foreign"] } })).status, 404);
      const loose = await call(b.app, "POST", "/policies/reallocation", { auth, body: { agentIds: ["registered-1", "no-account-1"], reallocationCap: 0.5 } });
      assert.equal(loose.status, 400);
      assert.equal(loose.body.error, "loosens-protocol-bound");
      assert.equal((await call(b.app, "POST", "/policies/reallocation", { auth, body: { agentIds: ["registered-1"] } })).status, 400);
    });

    it("relays the reallocation contract's EIP-712 typed data, records the verified signature, and commits it", async () => {
      await register("registered-2");
      await giveAccount("registered-2", ACCOUNT_2);
      const res = await call(b.app, "POST", "/policies/reallocation", { auth, body: { agentIds: ["registered-1", "registered-2"], reallocationCap: 0.1 } });
      assert.equal(res.status, 202);
      const op = res.body.operation;
      assert.equal(op.signatureRequest.kind, "typed-data");
      const typed = op.signatureRequest.typedData;
      assert.equal(typed.primaryType, "ReallocationPolicy");
      assert.equal(typed.domain.name, "Monadeum Reallocation");
      assert.equal(String(typed.domain.chainId), "10143");
      assert.equal(typed.domain.verifyingContract.toLowerCase(), "0x000000000000000000000000000000000000a110");
      assert.deepEqual(typed.message.agents.map((a: string) => a.toLowerCase()), [ACCOUNT_1, ACCOUNT_2.toLowerCase()]);
      assert.equal(Number(typed.message.capBps), 1_000);
      assert.equal(Number(typed.message.slotCeilingBps), 40_000);
      assert.equal(String(typed.message.capitalFloor), "60000");
      assert.equal(String(typed.message.nonce), "0");
      const expected = hashReallocationPolicy({
        owner: userOwner,
        agents: [ACCOUNT_1, ACCOUNT_2],
        capBps: 1_000,
        slotCeilingBps: 40_000,
        capitalFloor: 60_000n,
        nonce: 0n,
      });
      assert.equal(res.body.policy.policyHash, expected);
      assert.deepEqual(res.body.policy.document.agentIds, ["registered-1", "registered-2"]);
      const done = await signThrough(b.app, auth, op, owner);
      assert.equal(done.status, "succeeded");
      assert.equal(done.result.committed.txHash, `0x${"ab".repeat(32)}`);
      assert.equal(commits.length, 1);
      assert.equal((commits[0] as { policyHash: string }).policyHash, expected);
      const current = await call(b.app, "GET", "/policies/reallocation", { auth });
      assert.equal(current.body.policy.sequence, 0);
      assert.equal(current.body.policy.policyHash, expected);
      const me = await call(b.app, "GET", "/owners/me", { auth });
      assert.deepEqual(me.body.policy.agentIds, ["registered-1", "registered-2"]);
      assert.equal(me.body.policy.reallocationCap, 0.1);
      // The next proposal takes the next nonce, so a revoked or replaced signed policy cannot be replayed.
      const next = await call(b.app, "POST", "/policies/reallocation", { auth, body: { agentIds: ["registered-1", "registered-2"] } });
      assert.equal(next.body.policy.document.nonce, "1");
    });

    it("with the reallocation switch off, refuses every proposal with the reason, records nothing, and reports the switch", async () => {
      const off = await boot(backend, { settings: settings({ reallocation: REALLOCATION_DISABLED }) });
      try {
        const who = newWallet();
        const cookie = (await walletSignIn(off.app, who)).cookie;
        for (const id of ["off-1", "off-2"]) {
          assert.ok(await off.deps.agents.create({ agentId: id, owner: who.address, index: await off.deps.agents.nextIndex(who.address), name: id, preset: null, limits: { perTxCap: 1n, dailyCap: 1n }, registryId: null, createdAt: Date.now() }));
        }
        // A valid body and an invalid one both get the same refusal: the switch is checked before anything else.
        for (const body of [{ agentIds: ["off-1", "off-2"] }, {}]) {
          const res = await call(off.app, "POST", "/policies/reallocation", { auth: { cookie }, body });
          assert.equal(res.status, 409);
          assert.equal(res.body.error, "reallocation-disabled");
          assert.equal(res.body.detail, REALLOCATION_OFF_REASON);
        }
        assert.equal(await off.deps.policies.latest(who.address), undefined, "nothing recorded");
        const current = await call(off.app, "GET", "/policies/reallocation", { auth: { cookie } });
        assert.equal(current.status, 200);
        assert.deepEqual(current.body, { policy: null, reallocation: { enabled: false, reason: REALLOCATION_OFF_REASON } });
        const me = await call(off.app, "GET", "/owners/me", { auth: { cookie } });
        assert.deepEqual(me.body.reallocation, { enabled: false, reason: REALLOCATION_OFF_REASON });
      } finally {
        await off.close();
      }
    });

    it("with the reallocation switch on, the read endpoints report it on", async () => {
      const current = await call(b.app, "GET", "/policies/reallocation", { auth });
      assert.deepEqual(current.body.reallocation, { enabled: true, reason: null });
      assert.deepEqual((await call(b.app, "GET", "/owners/me", { auth })).body.reallocation, { enabled: true, reason: null });
    });

    it("refuses to build a policy before the reallocation contract is configured", async () => {
      const bare = await boot(backend, { settings: settings({ reallocationContract: null }) });
      try {
        const who = newWallet();
        const cookie = (await walletSignIn(bare.app, who)).cookie;
        for (const id of ["x-1", "x-2"]) {
          assert.ok(await bare.deps.agents.create({ agentId: id, owner: who.address, index: await bare.deps.agents.nextIndex(who.address), name: id, preset: null, limits: { perTxCap: 1n, dailyCap: 1n }, registryId: null, createdAt: Date.now() }));
        }
        const res = await call(bare.app, "POST", "/policies/reallocation", { auth: { cookie }, body: { agentIds: ["x-1", "x-2"] } });
        assert.equal(res.status, 503);
        assert.equal(res.body.error, "reallocation-contract-not-configured");
      } finally {
        await bare.close();
      }
    });
  });
}

describe("browser origin", () => {
  it("allows CORS with credentials for the web app's origin only", async () => {
    const b = await boot("memory");
    try {
      const allowed = await b.app.inject({ method: "OPTIONS", url: "/agents", headers: { origin: ORIGIN, "access-control-request-method": "POST" } });
      assert.equal(allowed.headers["access-control-allow-origin"], ORIGIN);
      assert.equal(allowed.headers["access-control-allow-credentials"], "true");
      const denied = await b.app.inject({ method: "OPTIONS", url: "/agents", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
      assert.notEqual(denied.headers["access-control-allow-origin"], "https://evil.example");
    } finally {
      await b.close();
    }
  });
});
