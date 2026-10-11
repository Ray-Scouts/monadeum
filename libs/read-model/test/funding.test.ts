import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address } from "viem";
import { ACCOUNT_DEPLOYED, SETTLEMENT_TRANSFER_IN, SETTLEMENT_TRANSFER_OUT, principalFrom, type ChainEvent } from "../src/index.js";

// principalFrom (EVOLUTION.md section 1.1): owner deposits minus owner withdrawals, from the configured settlement
// asset only, counted from the account's deployment, floored at 0, in chain order.

const USDC = "0x754704bc059f8c67012fed69bc8a327a5aafb603" as Address;
const OTHER_TOKEN = "0x5555555555555555555555555555555555555555" as Address;
const ACCOUNT = "0x00000000000000000000000000000000000000bb" as Address;
const SIBLING = "0x00000000000000000000000000000000000000bc" as Address;
const OWNER = "0x00000000000000000000000000000000000000aa" as Address;
const STRANGER = "0x00000000000000000000000000000000000000cc" as Address;
const REALLOCATION = "0x00000000000000000000000000000000000000c1" as Address;
const parties = { account: ACCOUNT, owner: OWNER, settlementAsset: USDC };

let index = 0;
function row(block: number, kind: string, data: Record<string, string>, address: Address = USDC, account: Address = ACCOUNT): ChainEvent {
  return {
    kind, account, address, blockNumber: BigInt(block), blockHash: `0x${block.toString(16).padStart(64, "0")}`,
    transactionHash: `0x${(index + 1).toString(16).padStart(64, "0")}`, logIndex: index++, data,
  };
}
const deployed = (block = 1) => row(block, ACCOUNT_DEPLOYED, { factory: STRANGER, paymaster: STRANGER }, STRANGER);
const into = (block: number, from: Address, value: bigint, token: Address = USDC) => row(block, SETTLEMENT_TRANSFER_IN, { from, to: ACCOUNT, value: value.toString() }, token);
const out = (block: number, to: Address, value: bigint, token: Address = USDC) => row(block, SETTLEMENT_TRANSFER_OUT, { from: ACCOUNT, to, value: value.toString() }, token);

test("an owner deposit raises principal and an owner withdrawal lowers it", () => {
  assert.equal(principalFrom(parties, [deployed(), into(2, OWNER, 100n)]), 100n);
  assert.equal(principalFrom(parties, [deployed(), into(2, OWNER, 100n), into(3, OWNER, 25n), out(4, OWNER, 40n)]), 85n);
});

test("third-party transfers, reallocation, trades, and x402 payments never change principal", () => {
  const rows = [
    deployed(),
    into(2, OWNER, 100n),
    into(3, STRANGER, 50n),
    into(4, REALLOCATION, 30n),
    out(5, REALLOCATION, 20n),
    out(6, SIBLING, 10n),
    // A trade's settlement-asset leg and an x402 payment both leave to someone other than the owner.
    out(7, STRANGER, 5n),
  ];
  assert.equal(principalFrom(parties, rows), 100n);
});

test("a transfer of any token other than the configured settlement asset is ignored, whatever it is called", () => {
  assert.equal(principalFrom(parties, [deployed(), into(2, OWNER, 1_000n, OTHER_TOKEN)]), 0n);
  assert.equal(principalFrom(parties, [deployed(), into(2, OWNER, 100n), out(3, OWNER, 100n, OTHER_TOKEN)]), 100n);
  // The same rows count once the configured address is theirs.
  assert.equal(principalFrom({ ...parties, settlementAsset: OTHER_TOKEN }, [deployed(), into(2, OWNER, 1_000n, OTHER_TOKEN)]), 1_000n);
});

test("nothing counts before the account's deployment, or without one", () => {
  assert.equal(principalFrom(parties, [into(1, OWNER, 100n)]), 0n);
  assert.equal(principalFrom(parties, [into(1, OWNER, 100n), deployed(2), into(3, OWNER, 7n)]), 7n);
});

test("withdrawals floor the running total at 0, folded in chain order whatever order the rows arrive in", () => {
  const rows = [deployed(), into(2, OWNER, 10n), out(3, OWNER, 15n), into(4, OWNER, 5n)];
  assert.equal(principalFrom(parties, rows), 5n);
  assert.equal(principalFrom(parties, [...rows].reverse()), 5n);
  assert.equal(principalFrom(parties, [deployed(), into(2, OWNER, 10n), out(3, OWNER, 10n)]), 0n);
});

test("addresses compare without case, and another account's rows are ignored", () => {
  const upper = (a: Address) => `0x${a.slice(2).toUpperCase()}` as Address;
  assert.equal(principalFrom({ account: upper(ACCOUNT), owner: upper(OWNER), settlementAsset: upper(USDC) }, [deployed(), into(2, OWNER, 9n)]), 9n);
  const sibling = row(2, SETTLEMENT_TRANSFER_IN, { from: OWNER, to: SIBLING, value: "9" }, USDC, SIBLING);
  assert.equal(principalFrom(parties, [deployed(), sibling]), 0n);
});
