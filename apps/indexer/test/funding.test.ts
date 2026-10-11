import assert from "node:assert/strict";
import { test } from "node:test";
import { SETTLEMENT_TRANSFER_IN, SETTLEMENT_TRANSFER_OUT, principalFrom } from "@monadeum/read-model";
import type { AbiEvent, Address } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { entryPointEvents, spendPolicyEvents, transferEvents } from "../src/handlers/abi.js";
import { defaultRegistry } from "../src/handlers/index.js";
import { Indexer, type SyncOptions } from "../src/indexer.js";
import { InMemoryReadModelStore } from "../src/store.js";
import { MockChain, type LogSpec } from "./mock-chain.js";

// Funding transfers (ARCHITECTURE.md section 6.1, EVOLUTION.md section 1.1): the indexer stores the settlement asset's
// Transfer events that touch a followed account, from the configured USDC contract only, and the principal function
// in @monadeum/read-model folds them. These tests run the real handlers over a mock chain and feed their rows to it.

const POLICY = "0x1111111111111111111111111111111111111111" as Address;
const ENTRY_POINT = entryPoint07Address.toLowerCase() as Address;
const FACTORY = "0xd703aae79538628d27099b8c4f621be4ccd142d5" as Address;
const USDC = "0x754704bc059f8c67012fed69bc8a327a5aafb603" as Address;
const FAKE_USDC = "0x5555555555555555555555555555555555555555" as Address;
const ACCOUNT = "0x2222222222222222222222222222222222222222" as Address;
const SIBLING = "0x2222222222222222222222222222222222222223" as Address;
const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const STRANGER = "0x3333333333333333333333333333333333333333" as Address;
const UNIT = 1_000_000n;

const registry = () => defaultRegistry({ spendPolicy: POLICY, entryPoint: ENTRY_POINT, kernelFactory: FACTORY, settlementAsset: USDC });
const parties = { account: ACCOUNT, owner: OWNER, settlementAsset: USDC };
const named = (events: readonly AbiEvent[], name: string) => events.find((e) => e.name === name)!;

const transfer = (from: Address, to: Address, value: bigint, token: Address = USDC): LogSpec => ({ address: token, event: transferEvents[0]!, args: { from, to, value } });
const deployment = (account: Address, tx: string = account): LogSpec[] => [
  { address: ENTRY_POINT, event: entryPointEvents[0]!, args: { userOpHash: `0x${"ab".repeat(32)}`, sender: account, factory: FACTORY, paymaster: STRANGER }, tx },
  { address: POLICY, event: named(spendPolicyEvents, "LimitsSet"), args: { account, perTxCap: 5n * UNIT, dailyCap: 20n * UNIT }, tx },
];

function setup(chain: MockChain, opts: Partial<SyncOptions> = {}) {
  const store = new InMemoryReadModelStore();
  const options: SyncOptions = { startBlock: 1n, batchSize: 100n, syncTo: "confirmations", confirmations: 0n, reorgWindow: 50n, ...opts };
  return { store, indexer: new Indexer(chain, store, registry(), options) };
}

async function drain(indexer: Indexer) {
  for (let i = 0; i < 100; i++) if ((await indexer.syncOnce()).status === "idle") return;
  throw new Error("did not converge");
}

test("stores the configured USDC's transfers to and from a followed account, and nothing from another token", async () => {
  const chain = new MockChain().mine(5, [
    [...deployment(ACCOUNT), ...deployment(SIBLING, "sibling")],
    // Funding through the relayed EIP-3009 transfer: the Transfer event names the owner wallet as `from`.
    [transfer(OWNER, ACCOUNT, 10n * UNIT)],
    // A token at another address emitting the same event, and a USDC transfer between two unfollowed addresses.
    [transfer(OWNER, ACCOUNT, 1_000n * UNIT, FAKE_USDC), transfer(OWNER, STRANGER, 7n * UNIT)],
    // A move between two followed accounts (reallocation-shaped) and a transfer from a third party.
    [transfer(ACCOUNT, SIBLING, 2n * UNIT), transfer(STRANGER, ACCOUNT, 3n * UNIT)],
    [transfer(ACCOUNT, OWNER, 4n * UNIT)],
  ]);
  const { store, indexer } = setup(chain);
  await drain(indexer);

  const rows = await store.events({ account: ACCOUNT });
  const transfers = rows.filter((r) => r.kind === SETTLEMENT_TRANSFER_IN || r.kind === SETTLEMENT_TRANSFER_OUT);
  assert.deepEqual(
    transfers.map((r) => [r.kind, r.address, r.data.from, r.data.to, r.data.value, Number(r.blockNumber)]),
    [
      [SETTLEMENT_TRANSFER_IN, USDC, OWNER, ACCOUNT, (10n * UNIT).toString(), 2],
      [SETTLEMENT_TRANSFER_OUT, USDC, ACCOUNT, SIBLING, (2n * UNIT).toString(), 4],
      [SETTLEMENT_TRANSFER_IN, USDC, STRANGER, ACCOUNT, (3n * UNIT).toString(), 4],
      [SETTLEMENT_TRANSFER_OUT, USDC, ACCOUNT, OWNER, (4n * UNIT).toString(), 5],
    ],
  );
  for (const r of transfers) assert.ok(r.transactionHash.startsWith("0x") && Number.isInteger(r.logIndex));
  // The move between the two followed accounts is stored once for each side.
  assert.deepEqual((await store.events({ account: SIBLING, kind: SETTLEMENT_TRANSFER_IN })).map((r) => r.data.from), [ACCOUNT]);
  assert.equal((await store.events({ account: STRANGER })).length, 0);
  assert.ok((await store.events()).every((r) => r.address !== FAKE_USDC));

  // Owner deposit 10, owner withdrawal 4; the third-party deposit and the move to the sibling change nothing.
  assert.equal(principalFrom(parties, rows), 6n * UNIT);
});

test("a reorg that removes a funding transfer removes its row, and the principal recomputed from the rows drops back", async () => {
  const chain = new MockChain().mine(4, [deployment(ACCOUNT), [], [transfer(OWNER, ACCOUNT, 10n * UNIT)], []]);
  const { store, indexer } = setup(chain);
  await drain(indexer);
  assert.equal(principalFrom(parties, await store.events({ account: ACCOUNT })), 10n * UNIT);

  // Blocks 3 and up are replaced; the replacement chain carries no funding transfer.
  chain.reorg(3, 3);
  const result = await indexer.syncOnce();
  assert.equal(result.status, "reorg");
  await drain(indexer);
  assert.equal((await store.events({ kind: SETTLEMENT_TRANSFER_IN })).length, 0);
  assert.equal(principalFrom(parties, await store.events({ account: ACCOUNT })), 0n);
  // A store filled under the confirmations rule never reports a finalized bound.
  assert.equal(await store.finalizedThrough(), null);
});

test("a funding transfer in the same batch as the deployment is followed, and the finalized rule marks the bound", async () => {
  const chain = new MockChain().mine(3, [deployment(ACCOUNT), [transfer(OWNER, ACCOUNT, 5n * UNIT)], []]);
  chain.finalityLag = 0;
  const { store, indexer } = setup(chain, { syncTo: "finalized" });
  await drain(indexer);
  assert.equal(principalFrom(parties, await store.events({ account: ACCOUNT })), 5n * UNIT);
  assert.equal(await store.finalizedThrough(), (await store.cursor())!.number);
});
