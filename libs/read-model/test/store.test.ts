// The full store behavior is held to the conformance suite in libs/db, which runs against this in-memory store and
// the Postgres one. This file checks only what this package adds on its own: chain order and cursor advancement.

import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryReadModelStore, chainOrder, type ChainEvent } from "../src/index.js";

const event = (block: number, logIndex: number, kind: string): ChainEvent => ({
  kind,
  account: null,
  address: "0x0000000000000000000000000000000000000001",
  blockNumber: BigInt(block),
  blockHash: `0x${block.toString(16).padStart(64, "0")}`,
  transactionHash: `0x${"00".repeat(32)}`,
  logIndex,
  data: {},
});

test("chain order is block, then log index, then kind", () => {
  const sorted = [event(2, 0, "a"), event(1, 1, "a"), event(1, 0, "b"), event(1, 0, "a")].sort(chainOrder);
  assert.deepEqual(sorted.map((e) => `${e.blockNumber}:${e.logIndex}:${e.kind}`), ["1:0:a", "1:0:b", "1:1:a", "2:0:a"]);
});

test("the in-memory store refuses a batch that does not advance the cursor", async () => {
  const store = new InMemoryReadModelStore();
  const cursor = { number: 5n, hash: event(5, 0, "x").blockHash };
  await store.apply({ events: [event(5, 0, "x")], blocks: [cursor], discovered: [], cursor, pruneBelow: 0n });
  await assert.rejects(store.apply({ events: [], blocks: [cursor], discovered: [], cursor, pruneBelow: 0n }), /does not advance/);
  assert.equal((await store.events()).length, 1);
});
