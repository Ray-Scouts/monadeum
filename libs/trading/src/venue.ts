import { ParamFetcher, PathFinder, TokenSwap, type RouteOutput } from "@kuru-labs/kuru-sdk";
import { ethers } from "ethers";
import { decodeEventLog, encodeEventTopics, formatUnits, parseUnits, zeroAddress, type Hex } from "viem";
import { ORDER_BOOK_ABI, ROUTER_ABI, type Book, type KuruMarket } from "./market.js";
import type { Call } from "./types.js";

/** Everything TradingService needs from the venue. `KuruSdkVenue` is the production implementation; tests mock it. */
export interface Venue {
  blockNumber(): Promise<bigint>;
  book(): Promise<Book>;
  takerFeeBps(): Promise<number>;
  /** Expected base out, in base units, for `quoteIn` quote base units, rounded down. */
  quoteBuy(quoteIn: bigint): Promise<bigint>;
  /** The router call that buys base with exactly `quoteIn`, reverting below `minBaseOut`. Native value is 0. */
  swapCall(account: Hex, quoteIn: bigint, minBaseOut: bigint): Promise<Call>;
  /** Expected quote out, in quote base units, for selling `baseIn` base units, rounded down. */
  quoteSell(baseIn: bigint): Promise<bigint>;
  /**
   * The router call that sells exactly `baseIn` base for quote, reverting below `minQuoteOut`. Native value is 0, so
   * it throws for a native-MON base, which the router can only take as native value.
   */
  sellCall(account: Hex, baseIn: bigint, minQuoteOut: bigint): Promise<Call>;
  /** Router swaps by `account` from `fromBlock` on, read from chain logs, independent of the signer. */
  swapsSince(account: Hex, fromBlock: bigint): Promise<{ transactionHash: Hex; blockNumber: bigint }[]>;
}

const big = (v: ethers.BigNumber) => v.toBigInt();
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Kuru through its official TypeScript SDK, `@kuru-labs/kuru-sdk` 0.0.95 (pinned exactly; it depends on ethers 5.7.1).
 * The SDK quotes the route (`PathFinder`), reads market parameters (`ParamFetcher`), and builds the router calldata
 * (`TokenSwap.constructSwapTransaction`). It never signs or sends: the calldata goes into an ExecutionPlan, the
 * RiskModule checks it, and the injected TradeSigner submits it.
 */
export class KuruSdkVenue implements Venue {
  private readonly pool;

  constructor(
    private readonly market: KuruMarket,
    private readonly provider: ethers.providers.JsonRpcProvider,
  ) {
    this.pool = { baseToken: market.base, quoteToken: market.quote, orderbook: market.market };
  }

  /** Confirms the configured market against the chain before any order is built. */
  async verifyMarket(): Promise<string[]> {
    const p = await ParamFetcher.getMarketParams(this.provider, this.market.market);
    const problems: string[] = [];
    if (!same(p.baseAssetAddress, this.market.base)) problems.push("base asset");
    if (!same(p.quoteAssetAddress, this.market.quote)) problems.push("quote asset");
    if (big(p.baseAssetDecimals) !== BigInt(this.market.baseDecimals)) problems.push("base decimals");
    if (big(p.quoteAssetDecimals) !== BigInt(this.market.quoteDecimals)) problems.push("quote decimals");
    if (big(p.sizePrecision) !== this.market.sizePrecision) problems.push("size precision");
    return problems;
  }

  async blockNumber(): Promise<bigint> {
    return BigInt(await this.provider.getBlockNumber());
  }

  async book(): Promise<Book> {
    const orderBook = new ethers.Contract(this.market.market, ORDER_BOOK_ABI as unknown as ethers.ContractInterface, this.provider);
    const [bid, ask] = (await orderBook.bestBidAsk()) as [ethers.BigNumber, ethers.BigNumber];
    return { bid: big(bid), ask: big(ask) };
  }

  async takerFeeBps(): Promise<number> {
    return Number(big((await ParamFetcher.getMarketParams(this.provider, this.market.market)).takerFeeBps));
  }

  async quoteBuy(quoteIn: bigint): Promise<bigint> {
    return this.quote(this.market.quote, this.market.base, quoteIn, this.market.quoteDecimals, this.market.baseDecimals);
  }

  async swapCall(account: Hex, quoteIn: bigint, minBaseOut: bigint): Promise<Call> {
    return buildSwapCall(this.market, account, quoteIn, minBaseOut, this.provider);
  }

  async quoteSell(baseIn: bigint): Promise<bigint> {
    return this.quote(this.market.base, this.market.quote, baseIn, this.market.baseDecimals, this.market.quoteDecimals);
  }

  async sellCall(account: Hex, baseIn: bigint, minQuoteOut: bigint): Promise<Call> {
    return buildSellCall(this.market, account, baseIn, minQuoteOut, this.provider);
  }

  /** The SDK's single-hop quote through `PathFinder.findBestPath`, which marks the hop a buy or a sell from the input token. */
  private async quote(tokenIn: Hex, tokenOut: Hex, amount: bigint, inDecimals: number, outDecimals: number): Promise<bigint> {
    const amountIn = Number(formatUnits(amount, inDecimals));
    const route = await PathFinder.findBestPath(this.provider, tokenIn, tokenOut, amountIn, "amountIn", undefined, [this.pool]);
    if (route.route.path.length !== 1 || !(route.output > 0)) return 0n;
    // The SDK returns a float. Truncate rather than round, so the quote never overstates what the book gives.
    const [whole, fraction = ""] = route.output.toFixed(outDecimals + 2).split(".");
    return parseUnits(`${whole}.${fraction.slice(0, outDecimals)}`, outDecimals);
  }

  async swapsSince(account: Hex, fromBlock: bigint) {
    const topic = encodeEventTopics({ abi: ROUTER_ABI, eventName: "KuruRouterSwap" })[0]!;
    const logs = await this.provider.getLogs({ address: this.market.router, topics: [topic], fromBlock: Number(fromBlock), toBlock: "latest" });
    return logs
      .filter((log) => {
        const { args } = decodeEventLog({ abi: ROUTER_ABI, eventName: "KuruRouterSwap", data: log.data as Hex, topics: log.topics as [Hex] });
        return args !== undefined && same(args.msgSender, account);
      })
      .map((log) => ({ transactionHash: log.transactionHash as Hex, blockNumber: BigInt(log.blockNumber) }));
  }
}

/**
 * Builds the router swap through the SDK without touching the network: a VoidSigner supplies the `from` address, and
 * a gas limit and price are passed so the SDK does not estimate. Both are discarded; the signer sets gas for the
 * operation. Exported so the calldata can be tested offline against the router interface issue #20 used.
 */
export async function buildSwapCall(
  market: KuruMarket,
  account: Hex,
  quoteIn: bigint,
  minBaseOut: bigint,
  provider?: ethers.providers.Provider,
): Promise<Call> {
  if (same(market.quote, zeroAddress)) throw new Error("a native quote asset would need native value, which an ExecutionPlan never carries");
  return routerCall(market, account, "buy", quoteIn, minBaseOut, provider);
}

/**
 * Builds the router sell of `baseIn` base for at least `minQuoteOut` quote, the same way. The SDK's own sell route
 * (`PathFinder`, checked in the installed 0.0.95 source) marks the hop `isBuy: false` and sets `nativeSend` when the
 * input token is the zero address, and `TokenSwap.constructSwapTransaction` then attaches `tokenInAmount` as native
 * value. A plan never carries native value and the on-chain spend policy reverts one with `NativeValueNotAllowed`
 * (ARCHITECTURE.md section 16.3), so a native-MON base is refused here rather than built.
 */
export async function buildSellCall(
  market: KuruMarket,
  account: Hex,
  baseIn: bigint,
  minQuoteOut: bigint,
  provider?: ethers.providers.Provider,
): Promise<Call> {
  if (same(market.base, zeroAddress)) throw new Error("selling a native-MON base needs native value, which an ExecutionPlan never carries");
  return routerCall(market, account, "sell", baseIn, minQuoteOut, provider);
}

async function routerCall(
  market: KuruMarket,
  account: Hex,
  side: "buy" | "sell",
  amountIn: bigint,
  minOut: bigint,
  provider?: ethers.providers.Provider,
): Promise<Call> {
  const [tokenIn, tokenOut] = side === "buy" ? [market.quote, market.base] : [market.base, market.quote];
  const route: RouteOutput = {
    route: { path: [{ baseToken: market.base, quoteToken: market.quote, orderbook: market.market }], tokenIn, tokenOut },
    isBuy: [side === "buy"],
    nativeSend: [false],
    output: 0,
    priceImpact: 0,
    feeInBase: 0,
  };
  const signer = new ethers.VoidSigner(account, provider);
  const one = ethers.BigNumber.from(1);
  const tx = await TokenSwap.constructSwapTransaction(signer, market.router, route, ethers.BigNumber.from(amountIn), ethers.BigNumber.from(minOut), {
    gasLimit: one,
    gasPrice: one,
  });
  if (!tx.to || !same(tx.to, market.router)) throw new Error("SDK built a call to an unexpected target");
  if (tx.value !== undefined && !ethers.BigNumber.from(tx.value).isZero()) throw new Error("SDK built a call with native value");
  if (typeof tx.data !== "string") throw new Error("SDK built a call without data");
  return { target: market.router, data: tx.data as Hex };
}
