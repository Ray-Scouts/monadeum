import assert from "node:assert/strict";
import { test } from "node:test";
import { ethers } from "ethers";
import { zeroAddress } from "viem";
import {
  KURU_MAINNET_MON_USDC,
  KURU_MAINNET_WETH_USDC,
  KuruBookMonPrice,
  TradingConfigError,
  kuruBookReader,
  loadTradingConfig,
  monBase,
  monPriceSourceOf,
} from "../src/index.js";

// Offline: configuration parsing and the MON price book rule. Nothing here opens a connection (an ethers provider
// constructed with a static network makes no request until it is used).

const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541";
const USDC_TESTNET = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const ROUTER_TESTNET = "0x7EFbE105Ca7415dE98F96622173458ac1c054630";
const MARKET_TESTNET = "0x46b66f84317941eC371E7791753f35653341aeBC";

/** The testnet variables as deploy/.env.testnet.example sets them. */
const testnet = {
  TRADING_PAIR: "WMON/USDC",
  TRADING_KURU_ROUTER: ROUTER_TESTNET,
  TRADING_KURU_MARKET: MARKET_TESTNET,
  TRADING_BASE: WMON,
  TRADING_QUOTE: USDC_TESTNET,
  TRADING_BASE_DECIMALS: "18",
  TRADING_QUOTE_DECIMALS: "6",
  TRADING_SIZE_PRECISION: "10000000000",
  TRADING_MON_PRICE_MARKET: MARKET_TESTNET,
  TRADING_MON_PRICE_BASE: WMON,
  TRADING_WRAPPED_NATIVE: WMON,
};

/** The mainnet default: WETH/USDC, gas priced on the native MON/USDC book. */
const mainnet = {
  TRADING_PAIR: KURU_MAINNET_WETH_USDC.pair,
  TRADING_KURU_ROUTER: KURU_MAINNET_WETH_USDC.router,
  TRADING_KURU_MARKET: KURU_MAINNET_WETH_USDC.market,
  TRADING_BASE: KURU_MAINNET_WETH_USDC.base,
  TRADING_QUOTE: KURU_MAINNET_WETH_USDC.quote,
  TRADING_SIZE_PRECISION: "10000000000",
  TRADING_MON_PRICE_MARKET: KURU_MAINNET_MON_USDC.market,
};

const offline = () => new ethers.providers.StaticJsonRpcProvider("http://127.0.0.1:1", { chainId: 10143, name: "offline" });

test("no TRADING_KURU_MARKET: trading is not configured", () => {
  assert.equal(loadTradingConfig({}), null);
  assert.equal(loadTradingConfig({ TRADING_PAIR: "WMON/USDC" }), null);
});

test("testnet: our WMON/USDC market, with the MON price read from the same WMON book", () => {
  const c = loadTradingConfig(testnet)!;
  assert.deepEqual(c.market, {
    pair: "WMON/USDC",
    router: ROUTER_TESTNET,
    market: MARKET_TESTNET,
    base: WMON,
    quote: USDC_TESTNET,
    baseDecimals: 18,
    quoteDecimals: 6,
    sizePrecision: 10_000_000_000n,
  });
  assert.deepEqual(c.monPrice, { market: MARKET_TESTNET, base: WMON, wrappedNative: WMON, source: "kuru-wmon-usdc-mid" });
  const source = monPriceSourceOf(c, offline());
  assert.ok(source instanceof KuruBookMonPrice);
  assert.equal(source.quote, USDC_TESTNET);
  assert.equal(source.source, "kuru-wmon-usdc-mid");
});

test("mainnet: WETH/USDC with the MON price from the native MON/USDC book, the existing default", () => {
  const c = loadTradingConfig(mainnet)!;
  const lower = (m: typeof c.market) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === "string" && v.startsWith("0x") ? v.toLowerCase() : v]));
  assert.deepEqual(lower(c.market), lower(KURU_MAINNET_WETH_USDC));
  assert.equal(c.monPrice!.market.toLowerCase(), KURU_MAINNET_MON_USDC.market.toLowerCase());
  assert.equal(c.monPrice!.base, zeroAddress);
  assert.equal(c.monPrice!.source, "kuru-mon-usdc-mid");
});

test("a native-MON market needs no MON price book; any other base does", () => {
  const native = { ...testnet, TRADING_BASE: zeroAddress, TRADING_MON_PRICE_MARKET: "" };
  assert.equal(loadTradingConfig(native)!.monPrice, null);
  assert.throws(() => loadTradingConfig({ ...testnet, TRADING_MON_PRICE_MARKET: "" }), /needs a MON price book/);
});

test("a MON price book on a token other than MON or the configured wrapped MON is refused", () => {
  assert.throws(() => loadTradingConfig({ ...testnet, TRADING_WRAPPED_NATIVE: "" }), TradingConfigError);
  assert.throws(() => loadTradingConfig({ ...mainnet, TRADING_MON_PRICE_BASE: KURU_MAINNET_WETH_USDC.base }), /native MON/);
  assert.throws(
    () => loadTradingConfig({ ...testnet, TRADING_WRAPPED_NATIVE: "0x0000000000000000000000000000000000000001" }),
    /TRADING_WRAPPED_NATIVE/,
  );
});

test("malformed values are refused", () => {
  assert.throws(() => loadTradingConfig({ ...testnet, TRADING_PAIR: "" }), /TRADING_PAIR is not set/);
  assert.throws(() => loadTradingConfig({ ...testnet, TRADING_PAIR: "WMON-USDC" }), /TRADING_PAIR/);
  assert.throws(() => loadTradingConfig({ ...testnet, TRADING_KURU_ROUTER: "0x1234" }), /TRADING_KURU_ROUTER is not an address/);
  assert.throws(() => loadTradingConfig({ ...testnet, TRADING_SIZE_PRECISION: "12345" }), /power of ten/);
  assert.throws(() => loadTradingConfig({ ...testnet, TRADING_SIZE_PRECISION: "" }), /TRADING_SIZE_PRECISION is not set/);
  assert.throws(() => loadTradingConfig({ ...testnet, TRADING_QUOTE_DECIMALS: "x" }), /TRADING_QUOTE_DECIMALS/);
  assert.throws(() => loadTradingConfig({ ...testnet, TRADING_QUOTE: zeroAddress }), /settlement asset/);
  assert.throws(() => loadTradingConfig({ ...testnet, TRADING_BASE: USDC_TESTNET }), /same token/);
});

test("the MON price reader accepts native MON, and wrapped MON only when it is configured", () => {
  const provider = offline();
  assert.ok(monBase(zeroAddress));
  assert.ok(monBase(WMON.toLowerCase() as `0x${string}`, WMON));
  assert.equal(monBase(WMON), false);
  assert.doesNotThrow(() => kuruBookReader(KURU_MAINNET_MON_USDC, provider));
  assert.throws(() => kuruBookReader({ market: MARKET_TESTNET, base: WMON }, provider), /native MON/);
  assert.doesNotThrow(() => kuruBookReader({ market: MARKET_TESTNET, base: WMON }, provider, { wrappedNative: WMON }));
  assert.throws(() => kuruBookReader(KURU_MAINNET_WETH_USDC, provider, { wrappedNative: WMON }), /native MON/);
});
