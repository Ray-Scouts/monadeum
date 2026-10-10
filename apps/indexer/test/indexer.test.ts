import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAbi, type AbiEvent, type Address } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { entryPointEvents, kernelEvents, spendPolicyEvents } from "../src/handlers/abi.js";
import { defaultRegistry } from "../src/handlers/index.js";
import { DeepReorgError, Indexer, type SyncOptions } from "../src/indexer.js";
import { accountView } from "../src/read-model.js";
import { HandlerRegistry, HandlerRegistryError } from "../src/registry.js";
import { InMemoryReadModelStore } from "../src/store.js";
import type { EventHandler } from "../src/types.js";
import { MockChain, type LogSpec } from "./mock-chain.js";

const POLICY = "0x1111111111111111111111111111111111111111" as Address;
const ENTRY_POINT = entryPoint07Address.toLowerCase() as Address;
const ACCOUNT = "0x2222222222222222222222222222222222222222" as Address;
const STRANGER = "0x3333333333333333333333333333333333333333" as Address;
const FACTORY = "0xd703aae79538628d27099b8c4f621be4ccd142d5" as Address;
const USDC = "0x4444444444444444444444444444444444444444" as Address;

const options: SyncOptions = { startBlock: 1n, batchSize: 100n, confirmations: 0n, reorgWindow: 50n };

function event(events: readonly AbiEvent[], name: string): AbiEvent {
  return events.find((e) => e.name === name)!;
}

const policy = (name: string, args: Record<string, unknown>): LogSpec => ({ address: POLICY, event: event(spendPolicyEvents, name), args });
const kernel = (account: Address, name: string, args: Record<string, unknown>): LogSpec => ({ address: account, event: event(kernelEvents, name), args });
const deployed = (sender: Address): LogSpec => ({
  address: ENTRY_POINT,
  event: entryPointEvents[0]!,
  args: { userOpHash: `0x${"ab".repeat(32)}`, sender, factory: FACTORY, paymaster: "0x0000000000000000000000000000000000000000" },
});

function setup(chain: MockChain, opts: Partial<SyncOptions> = {}) {
  const store = new InMemoryReadModelStore();
  const indexer = new Indexer(chain, store, defaultRegistry({ spendPolicy: POLICY, entryPoint: ENTRY_POINT }), { ...options, ...opts });
  return { store, indexer };
}

async function drain(indexer: Indexer) {
  for (let i = 0; i < 100; i++) {
    const r = await indexer.syncOnce();
    if (r.status === "idle") return;
  }
  throw new Error("did not converge");
}

/** The deployment operation as WalletsModule sends it: deploy, set limits, allow USDC transfer. */
function deploymentBlock(account: Address): LogSpec[] {
  return [
    deployed(account),
    policy("LimitsSet", { account, perTxCap: 5_000_000n, dailyCap: 20_000_000n }),
    policy("CallAllowed", { account, target: USDC, selector: "0xa9059cbb", allowed: true }),
  ];
}

test("indexes the spend policy, the deployment, and the session key lifecycle of an account the policy discovered", async () => {
  const chain = new MockChain().mine(5, [
    deploymentBlock(ACCOUNT),
    [kernel(ACCOUNT, "PermissionInstalled", { permission: "0xdeadbeef", nonce: 1 })],
    [policy("Spent", { account: ACCOUNT, amount: 1_000_000n, windowTotal: 1_000_000n })],
    [kernel(ACCOUNT, "PermissionUninstalled", { permission: "0xdeadbeef" }), kernel(ACCOUNT, "NonceInvalidated", { nonce: 2 })],
    // A Kernel account that never configured the spend policy is not followed.
    [kernel(STRANGER, "PermissionInstalled", { permission: "0x01020304", nonce: 1 }), deployed(STRANGER)],
  ]);
  const { store, indexer } = setup(chain);
  await drain(indexer);

  assert.deepEqual(await store.trackedAccounts(), [ACCOUNT]);
  assert.equal((await store.events({ account: STRANGER })).length, 0);

  const view = await accountView(store, ACCOUNT);
  assert.equal(view.deployment?.factory, FACTORY);
  assert.equal(view.deployment?.blockNumber, 1n);
  assert.deepEqual(view.limits, { perTxCap: 5_000_000n, dailyCap: 20_000_000n });
  assert.deepEqual(view.allowed, [{ target: USDC, selector: "0xa9059cbb" }]);
  assert.deepEqual(view.lastSpent, { amount: 1_000_000n, windowTotal: 1_000_000n, blockNumber: 3n });
  assert.equal(view.invalidatedNonce, 2);
  assert.deepEqual(view.permissions.map((p) => [p.permissionId, p.uninstalled, p.live]), [["0xdeadbeef", true, false]]);
  assert.deepEqual((await store.cursor())?.number, 5n);
});

test("a session key is live between installation and revocation", async () => {
  const chain = new MockChain().mine(2, [deploymentBlock(ACCOUNT), [kernel(ACCOUNT, "PermissionInstalled", { permission: "0xdeadbeef", nonce: 1 })]]);
  const { store, indexer } = setup(chain);
  await drain(indexer);
  assert.equal((await accountView(store, ACCOUNT)).permissions[0]?.live, true);
});

test("honours confirmation depth and batch size, and resumes from the stored cursor", async () => {
  const chain = new MockChain().mine(30, [deploymentBlock(ACCOUNT)]);
  const store = new InMemoryReadModelStore();
  const registry = defaultRegistry({ spendPolicy: POLICY, entryPoint: ENTRY_POINT });
  const first = new Indexer(chain, store, registry, { ...options, batchSize: 10n, confirmations: 5n });

  assert.deepEqual(await first.syncOnce(), { status: "indexed", from: 1n, to: 10n, events: 3, caughtUp: false });
  // A new process over the same store continues from the cursor rather than from the start block.
  const second = new Indexer(chain, store, registry, { ...options, batchSize: 10n, confirmations: 5n });
  assert.deepEqual(await second.syncOnce(), { status: "indexed", from: 11n, to: 20n, events: 0, caughtUp: false });
  assert.deepEqual(await second.syncOnce(), { status: "indexed", from: 21n, to: 25n, events: 0, caughtUp: true });
  assert.deepEqual(await second.syncOnce(), { status: "idle", cursor: 25n });
});

test("starts at the configured start block", async () => {
  const chain = new MockChain().mine(4, [[], deploymentBlock(ACCOUNT)]);
  const { store, indexer } = setup(chain, { startBlock: 3n });
  await drain(indexer);
  assert.equal((await store.events()).length, 0);
  assert.equal((await store.cursor())?.number, 4n);
});

test("a reorg that removes an indexed event rolls it back and re-indexes the canonical chain", async () => {
  const chain = new MockChain().mine(6, [
    deploymentBlock(ACCOUNT),
    [],
    [policy("Spent", { account: ACCOUNT, amount: 1_000_000n, windowTotal: 1_000_000n })],
    [kernel(ACCOUNT, "PermissionInstalled", { permission: "0xdeadbeef", nonce: 1 })],
    [deployed(STRANGER), policy("LimitsSet", { account: STRANGER, perTxCap: 1n, dailyCap: 1n })],
  ]);
  const { store, indexer } = setup(chain);
  await drain(indexer);
  assert.equal((await store.events({ kind: "spend.spent" })).length, 1);
  assert.deepEqual((await store.trackedAccounts()).sort(), [ACCOUNT, STRANGER]);

  // Blocks 3 onward are replaced: the Spent event and the second account's discovery no longer exist, and the
  // canonical chain carries a different spend instead.
  chain.reorg(3, 5, [[], [], [policy("Spent", { account: ACCOUNT, amount: 7n, windowTotal: 7n })]]);

  // Hashes are stored only for blocks that produced rows and for batch boundaries, so the rollback goes to block 1,
  // the newest stored block still canonical, and block 2 is re-indexed along with the replaced blocks.
  assert.deepEqual(await indexer.syncOnce(), { status: "reorg", rolledBackTo: 1n, discarded: 5n });
  assert.equal((await store.events({ kind: "spend.spent" })).length, 0);
  assert.equal((await store.events({ kind: "kernel.permission-installed" })).length, 0);
  assert.deepEqual(await store.trackedAccounts(), [ACCOUNT]);

  await drain(indexer);
  const spent = await store.events({ kind: "spend.spent" });
  assert.deepEqual(spent.map((e) => [e.blockNumber, e.data.amount, e.blockHash]), [[5n, "7", chain.blocks[5]!.hash]]);
  assert.equal((await store.events({ account: STRANGER })).length, 0);
  assert.equal((await store.cursor())?.hash, chain.blocks[7]!.hash);
  const view = await accountView(store, ACCOUNT);
  assert.equal(view.permissions.length, 0);
  assert.equal(view.totalSpent, 7n);
});

test("a reorg deeper than the window stops the indexer instead of guessing", async () => {
  const chain = new MockChain().mine(20, [deploymentBlock(ACCOUNT)]);
  const { indexer } = setup(chain, { reorgWindow: 5n, batchSize: 4n });
  await drain(indexer);
  chain.reorg(2, 20);
  await assert.rejects(indexer.syncOnce(), DeepReorgError);
});

test("a batch whose logs disagree with the canonical block hash is retried, not stored", async () => {
  const chain = new MockChain().mine(3, [deploymentBlock(ACCOUNT)]);
  const { store, indexer } = setup(chain);
  chain.blockOverride = (n) => (n === 1n ? { number: 1n, hash: `0x${"99".repeat(32)}`, parentHash: chain.blocks[0]!.hash } : undefined);
  const result = await indexer.syncOnce();
  assert.equal(result.status, "retry");
  assert.equal(await store.cursor(), null);
  assert.equal((await store.events()).length, 0);
  chain.blockOverride = null;
  await drain(indexer);
  assert.equal((await store.events()).length, 3);
});

test("a batch that does not extend the cursor is retried", async () => {
  const chain = new MockChain().mine(3);
  const { store, indexer } = setup(chain, { batchSize: 2n });
  await indexer.syncOnce();
  chain.blockOverride = (n) => (n === 3n ? { number: 3n, hash: `0x${"77".repeat(32)}`, parentHash: `0x${"66".repeat(32)}` } : undefined);
  assert.equal((await indexer.syncOnce()).status, "retry");
  assert.equal((await store.cursor())?.number, 2n);
});

test("a further contract is added by registering a handler, without changing the core", async () => {
  const REALLOCATION = "0x5555555555555555555555555555555555555555" as Address;
  // A stand-in shape for the reallocation contract (issue #31); its real events are defined there.
  const events = parseAbi(["event Reallocated(address indexed owner, address indexed source, address indexed sink, uint256 amount)"]);
  const handler: EventHandler = {
    name: "reallocation-example",
    source: { kind: "contract", address: REALLOCATION },
    events,
    kinds: ["reallocation.moved"],
    handle: ({ args }) => ({ kind: "reallocation.moved", account: String(args.source).toLowerCase() as Address, data: { amount: String(args.amount) } }),
  };
  const chain = new MockChain().mine(2, [
    deploymentBlock(ACCOUNT),
    [{ address: REALLOCATION, event: events[0]!, args: { owner: STRANGER, source: ACCOUNT, sink: STRANGER, amount: 3n } }],
  ]);
  const store = new InMemoryReadModelStore();
  const registry = defaultRegistry({ spendPolicy: POLICY, entryPoint: ENTRY_POINT }).register(handler);
  const indexer = new Indexer(chain, store, registry, options);
  await drain(indexer);
  const moved = await store.events({ kind: "reallocation.moved" });
  assert.deepEqual(moved.map((e) => [e.account, e.data.amount]), [[ACCOUNT, "3"]]);
  // A non-discovery handler does not add accounts to the tracked set.
  assert.deepEqual(await store.trackedAccounts(), [ACCOUNT]);
});

test("the registry rejects a duplicate handler name or kind", () => {
  const registry = defaultRegistry({ spendPolicy: POLICY, entryPoint: ENTRY_POINT });
  const base: EventHandler = { name: "x", source: { kind: "account" }, events: kernelEvents, kinds: ["spend.spent"], handle: () => null };
  assert.throws(() => registry.register(base), HandlerRegistryError);
  assert.throws(() => registry.register({ ...base, name: "agent-spend-policy", kinds: ["other"] }), HandlerRegistryError);
  assert.throws(() => new HandlerRegistry().register({ ...base, events: [] }), HandlerRegistryError);
});

test("rejects options where the reorg window does not cover the confirmation depth", () => {
  assert.throws(() => setup(new MockChain(), { confirmations: 10n, reorgWindow: 10n }));
});

test("verifyChain refuses an RPC on another chain", async () => {
  const { indexer } = setup(new MockChain(1));
  await assert.rejects(indexer.verifyChain(10143));
});
