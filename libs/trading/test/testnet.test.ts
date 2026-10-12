import assert from "node:assert/strict";
import { test } from "node:test";
import { ethers } from "ethers";
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { KURU_TESTNET_MON_USDC, KuruSdkVenue, loadTradingConfig, monPriceSourceOf } from "../src/index.js";

// Opt-in, read-only: KURU_TESTNET=1 and MONAD_TESTNET_RPC set. Nothing is signed or sent.
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

// The dry run of the configured market (ARCHITECTURE.md section 10, "Testnet market"), opt-in: KURU_DRY_RUN=1,
// DRY_RUN_RPC_URL, and the TRADING_* variables of deploy/.env.testnet.example. Against any RPC it verifies the market,
// reads the book and the MON price, and quotes and builds a buy of DRY_RUN_QUOTE_IN (default 1 USDC) and the close
// of what that buy returns, through the pinned SDK on the configured pool list. Read-only.
//
// With DRY_RUN_FORK_EXECUTE=1 it also sends both calls, from DRY_RUN_TAKER, but only on an anvil fork: it refuses
// unless the RPC answers `anvil_nodeInfo`, and it impersonates the taker there, so no key exists and nothing reaches a
// real network. The taker needs the quote asset on the fork.
const dryRpc = process.env.DRY_RUN_RPC_URL;
const dryRun = process.env.KURU_DRY_RUN === "1" && Boolean(dryRpc);

test("dry run: quote and build a buy and its close on the configured market", { skip: !dryRun && "set KURU_DRY_RUN=1, DRY_RUN_RPC_URL, and TRADING_*" }, async () => {
  const config = loadTradingConfig(process.env);
  assert.ok(config, "TRADING_KURU_MARKET is not set");
  const provider = new ethers.providers.StaticJsonRpcProvider(dryRpc, { chainId: 10143, name: "monad-testnet" });
  assert.equal((await provider.getNetwork()).chainId, 10143, "Monad testnet or a fork of it only");
  const { market } = config;
  const venue = new KuruSdkVenue(market, provider);
  assert.deepEqual(await venue.verifyMarket(), [], "the configured market matches getMarketParams");

  const book = await venue.book();
  const mon = await monPriceSourceOf(config, provider)?.monPrice();
  const fmt = (v: bigint, d: number) => ethers.utils.formatUnits(v, d);
  console.log(`book: bid ${fmt(book.bid, 18)} ask ${fmt(book.ask, 18)} (quote per base); taker fee ${await venue.takerFeeBps()} bps`);
  console.log(`MON price for gas: ${mon ? `${fmt(mon.price, 18)} from ${mon.source}` : "unavailable (a trade would be refused: gas-price)"}`);
  if (config.monPrice) assert.ok(mon, "the MON price book is readable, two-sided, and within its limits");

  const taker = (process.env.DRY_RUN_TAKER ?? "0x000000000000000000000000000000000000dEaD") as Hex;
  const quoteIn = BigInt(process.env.DRY_RUN_QUOTE_IN ?? "1000000");
  const baseOut = await venue.quoteBuy(quoteIn);
  assert.ok(baseOut > 0n, "the SDK quotes a buy from the pool list");
  const buy = await venue.swapCall(taker, quoteIn, (baseOut * 9_900n) / 10_000n);
  assert.equal(buy.target.toLowerCase(), market.router.toLowerCase());
  const quoteBack = await venue.quoteSell(baseOut);
  assert.ok(quoteBack > 0n, "the SDK quotes the close from the pool list");
  const sell = await venue.sellCall(taker, baseOut, (quoteBack * 9_900n) / 10_000n);
  assert.equal(sell.target.toLowerCase(), market.router.toLowerCase());
  const price = (q: bigint, b: bigint) => fmt((q * 10n ** 18n * 10n ** BigInt(market.baseDecimals)) / (b * 10n ** BigInt(market.quoteDecimals)), 18);
  console.log(`buy:   ${fmt(quoteIn, market.quoteDecimals)} quote -> ${fmt(baseOut, market.baseDecimals)} base, at ${price(quoteIn, baseOut)}`);
  console.log(`close: ${fmt(baseOut, market.baseDecimals)} base -> ${fmt(quoteBack, market.quoteDecimals)} quote, at ${price(quoteBack, baseOut)}`);

  if (process.env.DRY_RUN_FORK_EXECUTE !== "1") return;
  try {
    await provider.send("anvil_nodeInfo", []);
  } catch {
    assert.fail("DRY_RUN_FORK_EXECUTE=1 runs only against an anvil fork, and this RPC is not one");
  }
  await provider.send("anvil_impersonateAccount", [taker]);
  const signer = provider.getUncheckedSigner(taker);
  const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
  const balance = async (token: Hex) =>
    BigInt(await provider.call({ to: token, data: encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [taker] }) }));
  const send = async (to: Hex, data: Hex) => {
    const receipt = await (await signer.sendTransaction({ to, data, value: 0 })).wait();
    assert.equal(receipt.status, 1);
    return receipt;
  };
  const approve = (token: Hex, amount: bigint) => encodeFunctionData({ abi: erc20, functionName: "approve", args: [market.router, amount] });

  const quote0 = await balance(market.quote);
  const base0 = await balance(market.base);
  await send(market.quote, approve(market.quote, quoteIn));
  const bought = await send(buy.target, buy.data);
  const got = (await balance(market.base)) - base0;
  console.log(`fork buy:   gas ${bought.gasUsed.toString()}, received ${fmt(got, market.baseDecimals)} base (quoted ${fmt(baseOut, market.baseDecimals)})`);
  assert.ok(got >= (baseOut * 9_900n) / 10_000n);
  await send(market.base, approve(market.base, baseOut));
  const sold = await send(sell.target, sell.data);
  const quote1 = await balance(market.quote);
  console.log(`fork close: gas ${sold.gasUsed.toString()}, round trip ${fmt(quote1 - quote0, market.quoteDecimals)} quote`);
  assert.ok(quote1 - quote0 + quoteIn >= (quoteBack * 9_900n) / 10_000n);
  await provider.send("anvil_stopImpersonatingAccount", [taker]);
});
