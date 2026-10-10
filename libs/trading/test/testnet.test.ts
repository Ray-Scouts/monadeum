import assert from "node:assert/strict";
import { test } from "node:test";
import { ethers } from "ethers";
import { KURU_TESTNET_MON_USDC, KuruSdkVenue } from "../src/index.js";

// Opt-in, read-only: KURU_TESTNET=1 and MONAD_TESTNET_RPC set. Nothing is signed or sent; signing waits on WalletsModule.
const rpc = process.env.MONAD_TESTNET_RPC;
const enabled = process.env.KURU_TESTNET === "1" && Boolean(rpc);

test("Kuru testnet: the configured market matches the chain and the SDK quotes and builds a swap", { skip: !enabled && "set KURU_TESTNET=1 and MONAD_TESTNET_RPC" }, async () => {
  const provider = new ethers.providers.StaticJsonRpcProvider(rpc, { chainId: 10143, name: "monad-testnet" });
  assert.equal((await provider.getNetwork()).chainId, 10143);
  const venue = new KuruSdkVenue(KURU_TESTNET_MON_USDC, provider);
  assert.deepEqual(await venue.verifyMarket(), []);
  const book = await venue.book();
  assert.ok(book.ask > 0n);
  const out = await venue.quoteBuy(1_000_000n);
  assert.ok(out > 0n);
  const call = await venue.swapCall("0x000000000000000000000000000000000000dEaD", 1_000_000n, out);
  assert.equal(call.target, KURU_TESTNET_MON_USDC.router);
});
