import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getAddress, type Address } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { boot, call, createAgent, newWallet, privySignIn, signRequest, walletSignIn, type Backend, type Booted, type Credential } from "./harness.js";
import { FakeFundingChain, FUNDING_ASSET } from "./fake-funding.js";

// The relayed funding transfer end to end (ARCHITECTURE.md sections 6.1 and 7): prepare, sign with the owner's wallet,
// submit, relay, and status, against an in-memory USDC with EIP-3009 semantics. On PGlite every statement runs under
// `monadeum_api`, so a missing grant on migration 0014 fails here.

const RELAYER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d").address;

interface Fixture {
  b: Booted;
  usdc: FakeFundingChain;
}

async function start(backend: Backend, daily = 3): Promise<Fixture> {
  let usdc!: FakeFundingChain;
  const b = await boot(backend, {
    funding: (chain, clock) => {
      usdc = new FakeFundingChain(RELAYER, (account) => chain.isDeployed(account), () => BigInt(Math.floor(clock.now / 1000)));
      return { chain: usdc, settings: { maxPerTransfer: 100_000_000n, dailyTransfersPerUser: daily, validitySeconds: 600 } };
    },
  });
  return { b, usdc };
}

async function prepare(b: Booted, auth: Credential, agentId: string, value: string) {
  return call(b.app, "POST", `/agents/${agentId}/funding/prepare`, { auth, body: { value } });
}

async function submit(b: Booted, auth: Credential, agentId: string, nonce: string, signature: string) {
  return call(b.app, "POST", `/agents/${agentId}/funding/submit`, { auth, body: { nonce, signature } });
}

/** Signs exactly the typed data the API returned, as the owner's wallet does. */
const sign = (account: PrivateKeyAccount, typedData: unknown) => signRequest(account, { kind: "typed-data", typedData });

for (const backend of ["memory", "pglite"] as Backend[]) {
  describe(`${backend}: fund this agent`, () => {
    let f: Fixture;
    const alice = newWallet();
    const mallory = newWallet();
    let aliceAuth: { bearer: string };
    let malloryAuth: { cookie: string };
    let agentId: string;
    let account: Address;

    before(async () => {
      f = await start(backend);
      aliceAuth = { bearer: (await privySignIn(f.b.app, "did:privy:alice", alice)).bearer };
      malloryAuth = { cookie: (await walletSignIn(f.b.app, mallory)).cookie };
      ({ agentId, account } = await createAgent(f.b.app, aliceAuth, alice, "funded"));
      f.usdc.fund(alice.address, 50_000_000n);
      f.usdc.fund(mallory.address, 50_000_000n);
    });
    after(() => f.b.close());

    it("health shows the relayer's address only", async () => {
      const res = await call(f.b.app, "GET", "/health");
      assert.equal(res.status, 200);
      assert.equal(res.body.funding, "configured");
      assert.equal(res.body.fundingRelayer, RELAYER);
      assert.deepEqual(Object.keys(res.body).sort(), ["funding", "fundingRelayer", "status", "wallets"]);
    });

    it("serves the funding card: limits, budget, and the owner wallet's balance read from chain", async () => {
      const res = await call(f.b.app, "GET", `/agents/${agentId}/funding`, { auth: aliceAuth });
      assert.equal(res.status, 200);
      assert.equal(res.body.ownerBalance, "50000000");
      assert.equal(res.body.decimals, 6);
      assert.equal(res.body.deployed, true);
      assert.equal(getAddress(res.body.account), getAddress(account));
      assert.equal(res.body.owner, alice.address);
      assert.deepEqual(res.body.daily, { limit: 3, used: 0, remaining: 3 });
      assert.equal(res.body.relayer, RELAYER);
    });

    it("happy path: the owner signs, the relayer submits, and the transfer lands from the owner wallet to the account", async () => {
      const prepared = await prepare(f.b, aliceAuth, agentId, "2500000");
      assert.equal(prepared.status, 201);
      const td = prepared.body.typedData;
      assert.deepEqual(td.domain, { name: "USDC", version: "2", chainId: 10143, verifyingContract: FUNDING_ASSET });
      assert.equal(td.primaryType, "TransferWithAuthorization");
      assert.equal(td.message.from, alice.address, "from is the owner wallet on record");
      assert.equal(getAddress(td.message.to), getAddress(account), "to is the agent's deployed account");
      assert.equal(td.message.value, "2500000");
      assert.match(td.message.nonce, /^0x[0-9a-f]{64}$/);
      assert.ok(BigInt(td.message.validBefore) - BigInt(td.message.validAfter) <= 605n, "a short validity window");
      assert.equal(prepared.body.funding.status, "prepared");

      const signature = await sign(alice, td);
      const res = await submit(f.b, aliceAuth, agentId, td.message.nonce, signature);
      assert.equal(res.status, 202, JSON.stringify(res.body));
      assert.equal(res.body.funding.status, "confirmed");
      assert.match(res.body.funding.txHash, /^0x[0-9a-f]{64}$/);
      assert.equal(await f.usdc.balanceOf(account), 2_500_000n);
      assert.equal(await f.usdc.balanceOf(alice.address), 47_500_000n);
      assert.equal(f.usdc.sent.length, 1);

      const status = await call(f.b.app, "GET", `/agents/${agentId}/funding/${td.message.nonce}`, { auth: aliceAuth });
      assert.equal(status.status, 200);
      assert.equal(status.body.funding.status, "confirmed");
      assert.equal(status.body.funding.txHash, res.body.funding.txHash);
      assert.ok(status.body.funding.blockNumber);
    });

    it("a replayed nonce sends nothing again; another signature for it is refused", async () => {
      const prepared = await prepare(f.b, aliceAuth, agentId, "1000000");
      const { nonce } = prepared.body.typedData.message;
      const signature = await sign(alice, prepared.body.typedData);
      const first = await submit(f.b, aliceAuth, agentId, nonce, signature);
      assert.equal(first.status, 202);
      const sent = f.usdc.sent.length;
      const replay = await submit(f.b, aliceAuth, agentId, nonce, signature);
      assert.equal(replay.status, 202);
      assert.equal(replay.body.funding.status, "confirmed");
      assert.equal(replay.body.funding.txHash, first.body.funding.txHash);
      assert.equal(f.usdc.sent.length, sent, "nothing was relayed twice");
      const other = await submit(f.b, aliceAuth, agentId, nonce, await sign(alice, { ...prepared.body.typedData, message: { ...prepared.body.typedData.message, value: "1" } }));
      assert.equal(other.status, 409);
      assert.equal(other.body.error, "already-submitted");
    });

    it("refuses a signature that does not recover the owner over the stored authorization", async () => {
      const prepared = await prepare(f.b, aliceAuth, agentId, "1000000");
      const td = prepared.body.typedData;
      const byOther = await submit(f.b, aliceAuth, agentId, td.message.nonce, await sign(mallory, td));
      assert.equal(byOther.status, 400);
      assert.equal(byOther.body.error, "bad-signature");
      // The owner's signature over different fields (here, a larger value) does not match what the API stored.
      const otherValue = await submit(f.b, aliceAuth, agentId, td.message.nonce, await sign(alice, { ...td, message: { ...td.message, value: "9000000" } }));
      assert.equal(otherValue.status, 400);
      assert.equal(otherValue.body.error, "bad-signature");
      const otherRecipient = await submit(f.b, aliceAuth, agentId, td.message.nonce, await sign(alice, { ...td, message: { ...td.message, to: mallory.address } }));
      assert.equal(otherRecipient.status, 400);
      const status = await call(f.b.app, "GET", `/agents/${agentId}/funding/${td.message.nonce}`, { auth: aliceAuth });
      assert.equal(status.body.funding.status, "prepared", "nothing was claimed or sent");
    });

    it("another user cannot prepare, submit, or read funding for an agent they do not own", async () => {
      const own = await prepare(f.b, aliceAuth, agentId, "1000000");
      const td = own.body.typedData;
      for (const res of [
        await prepare(f.b, malloryAuth, agentId, "1000000"),
        await submit(f.b, malloryAuth, agentId, td.message.nonce, await sign(mallory, td)),
        await call(f.b.app, "GET", `/agents/${agentId}/funding`, { auth: malloryAuth }),
        await call(f.b.app, "GET", `/agents/${agentId}/funding/${td.message.nonce}`, { auth: malloryAuth }),
      ]) {
        assert.equal(res.status, 404);
        assert.equal(res.body.error, "not-found");
      }
      // Mallory's own agent cannot be used to submit Alice's nonce.
      const theirs = await createAgent(f.b.app, malloryAuth, mallory, "mallory");
      const crossed = await submit(f.b, malloryAuth, theirs.agentId, td.message.nonce, await sign(mallory, td));
      assert.equal(crossed.status, 404);
      assert.equal((await prepare(f.b, aliceAuth, agentId, "x")).status, 400);
    });

    it("refuses an amount above the per-transfer maximum, unknown fields, and more than the owner holds", async () => {
      const high = await prepare(f.b, aliceAuth, agentId, "100000001");
      assert.equal(high.status, 400);
      assert.equal(high.body.error, "limit-too-high");
      const extra = await call(f.b.app, "POST", `/agents/${agentId}/funding/prepare`, { auth: aliceAuth, body: { value: "1", to: mallory.address } });
      assert.equal(extra.status, 400);
      assert.equal(extra.body.error, "unknown-field");
      const poor = await prepare(f.b, aliceAuth, agentId, "99000000");
      assert.equal(poor.status, 409);
      assert.equal(poor.body.error, "insufficient-balance");
    });

    it("an expired authorization is reported expired and refused", async () => {
      const p = await prepare(f.b, aliceAuth, agentId, "1000000");
      assert.equal(p.status, 201, JSON.stringify(p.body));
      f.b.clock.now += 601_000;
      const res = await submit(f.b, aliceAuth, agentId, p.body.typedData.message.nonce, await sign(alice, p.body.typedData));
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "authorization-expired");
      const status = await call(f.b.app, "GET", `/agents/${agentId}/funding/${p.body.typedData.message.nonce}`, { auth: aliceAuth });
      assert.equal(status.body.funding.status, "expired");
    });

    it("refuses an agent whose account is not deployed: funds sent before deployment would not count as principal", async () => {
      const created = await call(f.b.app, "POST", "/agents", { auth: aliceAuth, body: { name: "undeployed", perTxCap: "1000000", dailyCap: "5000000" } });
      assert.equal(created.status, 202);
      const res = await prepare(f.b, aliceAuth, created.body.agent.id, "1000000");
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "account-not-deployed");
    });
  });

  describe(`${backend}: the funding budget and the relayer's balance`, () => {
    let f: Fixture;
    const owner = newWallet();
    let auth: { bearer: string };
    let agentId: string;
    before(async () => {
      f = await start(backend, 3);
      auth = { bearer: (await privySignIn(f.b.app, "did:privy:budget", owner)).bearer };
      ({ agentId } = await createAgent(f.b.app, auth, owner, "budget"));
      f.usdc.fund(owner.address, 50_000_000n);
    });
    after(() => f.b.close());

    it("fails closed with a clear error when the relayer cannot pay the gas, and claims nothing", async () => {
      f.usdc.relayerWei = 1n;
      const prepared = await prepare(f.b, auth, agentId, "1000000");
      const res = await submit(f.b, auth, agentId, prepared.body.typedData.message.nonce, await sign(owner, prepared.body.typedData));
      assert.equal(res.status, 503);
      assert.equal(res.body.error, "relayer-balance-low");
      assert.match(res.body.detail, new RegExp(RELAYER));
      const info = await call(f.b.app, "GET", `/agents/${agentId}/funding`, { auth });
      assert.equal(info.body.daily.used, 0, "the budget is untouched");
      f.usdc.relayerWei = 10n ** 18n;
      const retry = await submit(f.b, auth, agentId, prepared.body.typedData.message.nonce, await sign(owner, prepared.body.typedData));
      assert.equal(retry.status, 202);
      assert.equal(retry.body.funding.status, "confirmed");
    });

    it("a submission whose response is lost is still recorded and reconciled from the chain", async () => {
      f.usdc.sendMode = "lost-response";
      const prepared = await prepare(f.b, auth, agentId, "1000000");
      const res = await submit(f.b, auth, agentId, prepared.body.typedData.message.nonce, await sign(owner, prepared.body.typedData));
      f.usdc.sendMode = "ok";
      assert.equal(res.status, 202);
      assert.equal(res.body.funding.status, "confirmed");
    });

    it("refuses beyond the per-user daily budget, at prepare and at submit", async () => {
      // Two relays are already counted today (the tests above). Two more are prepared; the first takes the last relay.
      const a = await prepare(f.b, auth, agentId, "1000000");
      const c = await prepare(f.b, auth, agentId, "1000000");
      assert.equal(a.status, 201);
      assert.equal(c.status, 201);
      const ok = await submit(f.b, auth, agentId, a.body.typedData.message.nonce, await sign(owner, a.body.typedData));
      assert.equal(ok.status, 202);
      const over = await submit(f.b, auth, agentId, c.body.typedData.message.nonce, await sign(owner, c.body.typedData));
      assert.equal(over.status, 429);
      assert.equal(over.body.error, "funding-budget-exceeded");
      const status = await call(f.b.app, "GET", `/agents/${agentId}/funding/${c.body.typedData.message.nonce}`, { auth });
      assert.equal(status.body.funding.status, "prepared", "the refused submission was not claimed or sent");
      const again = await prepare(f.b, auth, agentId, "1000000");
      assert.equal(again.status, 429);
      assert.equal(again.body.error, "funding-budget-exceeded");
    });
  });
}

describe("funding without a relayer", () => {
  it("answers 503 funding-unavailable", async () => {
    const b = await boot("memory");
    try {
      const owner = newWallet();
      const auth = { bearer: (await privySignIn(b.app, "did:privy:none", owner)).bearer };
      const { agentId } = await createAgent(b.app, auth, owner);
      const res = await prepare(b, auth, agentId, "1");
      assert.equal(res.status, 503);
      assert.equal(res.body.error, "funding-unavailable");
      assert.equal((await call(b.app, "GET", "/health")).body.fundingRelayer, null);
    } finally {
      await b.close();
    }
  });
});
