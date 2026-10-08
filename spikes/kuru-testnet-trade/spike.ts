// Issue #20 spike. Throwaway code: it answers one question on Monad testnet and is not imported by anything.
// Question: what does one real Kuru market swap cost, in gas (as Monad actually charges it) and in fee plus
// slippage against the mid price, and how do those compare with ECONOMICS.md section 1's assumptions
// of 15 bps (10 bps fee + 5 bps slippage) and $0.001 of gas per trade?
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
  type StateOverride,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is not set, see .env.example`);
  return value;
};
const nonNegativeInt = (name: string, fallback: string): bigint => {
  const value = env(name, fallback);
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  return BigInt(value);
};

const dryRun = process.env.DRY_RUN === "1";
const rpcUrl = env("MONAD_RPC", "https://testnet-rpc.monad.xyz");
// Addresses from https://docs.kuru.io/contracts/Contract-addresses, testnet section, read 2026-10-08.
// The market is re-checked on-chain against the router's verifiedMarket mapping before anything else runs.
const router = env("KURU_ROUTER", "0x7EFbE105Ca7415dE98F96622173458ac1c054630") as Address;
const market = env("KURU_MARKET", "0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9") as Address;
const amountInText = env("AMOUNT_IN", "1");
const slippageBps = nonNegativeInt("SLIPPAGE_BPS", "50");
if (slippageBps >= 10_000n) throw new Error("SLIPPAGE_BPS must be below 10000");
const gasBufferBps = nonNegativeInt("GAS_BUFFER_BPS", "1000");
const maxGasPriceGwei = nonNegativeInt("MAX_GAS_PRICE_GWEI", "300");
// MON/USD is set by the human at test time from a named source, never fetched here. Required for a live run.
const monUsdText = process.env.MON_USD;
const monUsdSource = process.env.MON_USD_SOURCE;
if (!dryRun && (!monUsdText || !monUsdSource)) throw new Error("MON_USD and MON_USD_SOURCE must be set for a live run");
const monUsd = monUsdText ? Number(monUsdText) : null;
if (monUsd !== null && !(monUsd > 0)) throw new Error("MON_USD must be a positive number");

const ASSUMED_COST_BPS = 15;
const ASSUMED_GAS_USD = 0.001;

const chain = monadTestnet;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

const orderBookAbi = parseAbi([
  "function getMarketParams() view returns (uint32 pricePrecision, uint96 sizePrecision, address baseAsset, uint256 baseDecimals, address quoteAsset, uint256 quoteDecimals, uint32 tickSize, uint96 minSize, uint96 maxSize, uint256 takerFeeBps, uint256 makerFeeBps)",
  "function bestBidAsk() view returns (uint256 bid, uint256 ask)",
  "function getL2Book() view returns (bytes)",
  "event Trade(uint40 orderId, address makerAddress, bool isBuy, uint256 price, uint96 updatedSize, address takerAddress, address txOrigin, uint96 filledSize)",
]);
const routerAbi = parseAbi([
  "function verifiedMarket(address) view returns (uint32 pricePrecision, uint96 sizePrecision, address baseAsset, uint256 baseDecimals, address quoteAsset, uint256 quoteDecimals, uint32 tickSize, uint96 minSize, uint96 maxSize, uint256 takerFeeBps, uint256 makerFeeBps)",
  "function anyToAnySwap(address[] markets, bool[] isBuy, bool[] nativeSend, address debitToken, address creditToken, uint256 amount, uint256 minAmountOut) payable returns (uint256)",
  "event KuruRouterSwap(address msgSender, address debitToken, address creditToken, uint256 amountIn, uint256 amountOut)",
]);
const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);

// bestBidAsk returns prices scaled by 1e18 (quote per base). A side with no liquidity reads as 0 or 2^256-1.
const PRICE_SCALE = 10n ** 18n;
const MAX_UINT = 2n ** 256n - 1n;
const liveSide = (p: bigint) => p !== 0n && p !== MAX_UINT;
const price = (p: bigint) => (liveSide(p) ? Number(formatUnits(p, 18)) : null);
const bps = (x: number) => Math.round(x * 1e4 * 100) / 100;

type Book = { bid: bigint; ask: bigint; mid: number | null };
async function book(blockNumber?: bigint): Promise<Book> {
  const [bid, ask] = await publicClient.readContract({ address: market, abi: orderBookAbi, functionName: "bestBidAsk", blockNumber });
  const mid = liveSide(bid) && liveSide(ask) ? Number(formatUnits((bid + ask) / 2n, 18)) : null;
  return { bid, ask, mid };
}

/** Decodes getL2Book: a block number word, then (price, size) word pairs for bids, a zero word, then asks. */
function decodeL2(data: Hex, pricePrecision: bigint, sizePrecision: bigint) {
  const words = (data.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt(`0x${w}`));
  const sides: { price: number; size: number }[][] = [[], []];
  let i = 1;
  for (const side of sides) {
    while (i < words.length && words[i] !== 0n) {
      side.push({ price: Number(words[i]!) / Number(pricePrecision), size: Number(words[i + 1] ?? 0n) / Number(sizePrecision) });
      i += 2;
    }
    i++;
  }
  return { bids: sides[0]!, asks: sides[1]! };
}

/** Finds an OpenZeppelin-style balance and allowance layout so a dry run can simulate without holding any token. */
async function tokenOverride(token: Address, holder: Address, spender: Address, amount: bigint): Promise<StateOverride | null> {
  const word = (v: bigint) => `0x${v.toString(16).padStart(64, "0")}` as Hex;
  const slotOf = (key: Address, slot: bigint | Hex) =>
    keccak256(encodeAbiParameters([{ type: "address" }, { type: typeof slot === "bigint" ? "uint256" : "bytes32" }], [key, slot as never]));
  for (let base = 0n; base < 10n; base++) {
    const override: StateOverride = [{
      address: token,
      stateDiff: [{ slot: slotOf(holder, base), value: word(amount) }, { slot: slotOf(spender, slotOf(holder, base + 1n)), value: word(amount) }],
    }];
    const [bal, allowance] = await Promise.all([
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder], stateOverride: override }),
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [holder, spender], stateOverride: override }),
    ]);
    if (bal === amount && allowance === amount) return override;
  }
  return null;
}

async function main() {
  // Chain check first, before any key is touched or any write is attempted.
  const chainId = await publicClient.getChainId();
  if (chainId !== 10143) throw new Error(`MONAD_RPC returned chain ${chainId}, expected Monad testnet 10143`);

  // (b) Fee and market parameters, read on-chain from the market and cross-checked against the router registry.
  const params = await publicClient.readContract({ address: market, abi: orderBookAbi, functionName: "getMarketParams" });
  const registered = await publicClient.readContract({ address: router, abi: routerAbi, functionName: "verifiedMarket", args: [market] });
  const [pricePrecision, sizePrecision, baseAsset, baseDecimals, quoteAsset, quoteDecimals, tickSize, minSize, maxSize, takerFeeBps, makerFeeBps] = params;
  if (registered[0] === 0 || registered[2] !== baseAsset || registered[4] !== quoteAsset || registered[9] !== takerFeeBps) {
    throw new Error("market is not registered in the router's verifiedMarket mapping with matching parameters");
  }
  if (quoteAsset === zeroAddress) throw new Error("this spike buys base with an ERC20 quote asset; a native quote market is not supported");
  const quoteSymbol = await publicClient.readContract({ address: quoteAsset, abi: erc20Abi, functionName: "symbol" });
  const quoteTokenDecimals = await publicClient.readContract({ address: quoteAsset, abi: erc20Abi, functionName: "decimals" });
  if (BigInt(quoteTokenDecimals) !== quoteDecimals) throw new Error("quote decimals in market params differ from the token contract");
  const baseSymbol = baseAsset === zeroAddress ? "MON" : await publicClient.readContract({ address: baseAsset, abi: erc20Abi, functionName: "symbol" });
  const pair = `${baseSymbol}/${quoteSymbol}`;
  const amountIn = parseUnits(amountInText, Number(quoteDecimals));

  console.log(`chain ${chainId}, router ${router}, market ${market} (${pair})`);
  console.log(`base ${baseAsset} (${baseDecimals} decimals), quote ${quoteAsset} (${quoteDecimals} decimals)`);
  console.log(`on-chain fee params: takerFeeBps ${takerFeeBps}, makerFeeBps ${makerFeeBps}`);
  console.log(`pricePrecision ${pricePrecision}, sizePrecision ${sizePrecision}, tickSize ${tickSize}, minSize ${minSize}, maxSize ${maxSize}`);

  const pre = await book();
  const l2 = decodeL2(await publicClient.readContract({ address: market, abi: orderBookAbi, functionName: "getL2Book" }), BigInt(pricePrecision), sizePrecision);
  console.log(`best bid ${price(pre.bid) ?? "none"}, best ask ${price(pre.ask) ?? "none"}, mid ${pre.mid ?? "undefined (one side empty)"}`);
  console.log(`order book levels (excludes AMM vault): ${l2.bids.length} bid, ${l2.asks.length} ask; top ask ${JSON.stringify(l2.asks[0] ?? null)}`);
  if (!liveSide(pre.ask)) throw new Error("no ask liquidity: a market buy cannot fill");

  const gasPrice = await publicClient.getGasPrice();
  const head = await publicClient.getBlock({ blockTag: "latest" });
  console.log(`eth_gasPrice ${formatUnits(gasPrice, 9)} gwei, latest baseFeePerGas ${formatUnits(head.baseFeePerGas ?? 0n, 9)} gwei`);
  if (gasPrice > maxGasPriceGwei * 10n ** 9n) throw new Error(`gas price above MAX_GAS_PRICE_GWEI ${maxGasPriceGwei}, refusing to run`);

  const swapArgs = (minOut: bigint) => [[market], [true], [false], quoteAsset, baseAsset, amountIn, minOut] as const;

  if (dryRun) {
    // (c) Quote by simulation only. A placeholder holder gets the input balance and router allowance through a
    // state override, so no key, no token, and no transaction is involved.
    const holder = "0x000000000000000000000000000000000000dEaD" as Address;
    const override = await tokenOverride(quoteAsset, holder, router, amountIn);
    if (!override) {
      console.log("DRY RUN: could not locate the quote token's storage layout, quote skipped");
    } else {
      const sim = await publicClient.simulateContract({ address: router, abi: routerAbi, functionName: "anyToAnySwap", args: swapArgs(0n), account: holder, stateOverride: override });
      const gas = await publicClient.estimateContractGas({ address: router, abi: routerAbi, functionName: "anyToAnySwap", args: swapArgs(0n), account: holder, stateOverride: override });
      const out = sim.result;
      const effective = Number(formatUnits(amountIn, Number(quoteDecimals))) / Number(formatUnits(out, Number(baseDecimals)));
      const limit = gas + (gas * gasBufferBps) / 10_000n;
      console.log(`DRY RUN quote: ${amountInText} ${quoteSymbol} -> ${formatUnits(out, Number(baseDecimals))} ${baseSymbol}, effective price ${effective}`);
      console.log(`DRY RUN vs best ask: ${bps(effective / price(pre.ask)! - 1)} bps; vs mid: ${pre.mid === null ? "n/a, no mid" : `${bps(effective / pre.mid - 1)} bps`}`);
      console.log(`DRY RUN gas estimate ${gas}, limit with ${gasBufferBps} bps buffer ${limit}, charged at eth_gasPrice if Monad charges the limit: ${formatUnits(limit * gasPrice, 18)} MON${monUsd === null ? "" : ` = $${(Number(formatUnits(limit * gasPrice, 18)) * monUsd).toFixed(6)}`}`);
    }
    console.log("DRY RUN: stopped before any signing or network write");
    return;
  }

  const owner = privateKeyToAccount(env("OWNER_PRIVATE_KEY") as Hex);
  const wallet = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
  const quoteBalance = await publicClient.readContract({ address: quoteAsset, abi: erc20Abi, functionName: "balanceOf", args: [owner.address] });
  console.log(`owner ${owner.address}, ${quoteSymbol} balance ${formatUnits(quoteBalance, Number(quoteDecimals))}, MON balance ${formatUnits(await publicClient.getBalance({ address: owner.address }), 18)}`);
  if (quoteBalance < amountIn) throw new Error(`owner holds less than AMOUNT_IN ${amountInText} ${quoteSymbol}, see README for how to obtain it`);

  /** Measures one transaction from its receipt and the sender's native balance on either side of its block. */
  async function measure(hash: Hex, nativeCredited: bigint) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const tx = await publicClient.getTransaction({ hash });
    const [before, after] = await Promise.all([
      publicClient.getBalance({ address: owner.address, blockNumber: receipt.blockNumber - 1n }),
      publicClient.getBalance({ address: owner.address, blockNumber: receipt.blockNumber }),
    ]);
    // Native charge observed on-chain: what left the account, net of any native amount the swap credited.
    const charged = before - after + nativeCredited - tx.value;
    return { receipt, gasLimit: tx.gas, charged, atUsed: receipt.gasUsed * receipt.effectiveGasPrice, atLimit: tx.gas * receipt.effectiveGasPrice };
  }
  type Measured = Awaited<ReturnType<typeof measure>>;
  const withBuffer = (gas: bigint) => gas + (gas * gasBufferBps) / 10_000n;

  // Approve exactly AMOUNT_IN to the router, never an unbounded amount, matching ARCHITECTURE.md section 16.3's counting rule.
  let approval: Measured | null = null;
  const allowanceBefore = await publicClient.readContract({ address: quoteAsset, abi: erc20Abi, functionName: "allowance", args: [owner.address, router] });
  if (allowanceBefore < amountIn) {
    const gas = await publicClient.estimateContractGas({ address: quoteAsset, abi: erc20Abi, functionName: "approve", args: [router, amountIn], account: owner });
    const hash = await wallet.writeContract({ address: quoteAsset, abi: erc20Abi, functionName: "approve", args: [router, amountIn], gas: withBuffer(gas) });
    approval = await measure(hash, 0n);
    if (approval.receipt.status !== "success") throw new Error(`approve reverted: ${hash}`);
    console.log(`approved ${amountInText} ${quoteSymbol} to router in ${hash}`);
  }

  // (c) Quote from the owner's own state, then (d) submit with minAmountOut = quote less SLIPPAGE_BPS.
  const quote = (await publicClient.simulateContract({ address: router, abi: routerAbi, functionName: "anyToAnySwap", args: swapArgs(0n), account: owner })).result;
  const minOut = (quote * (10_000n - slippageBps)) / 10_000n;
  const swapGas = await publicClient.estimateContractGas({ address: router, abi: routerAbi, functionName: "anyToAnySwap", args: swapArgs(minOut), account: owner });
  console.log(`quote ${formatUnits(quote, Number(baseDecimals))} ${baseSymbol}, minAmountOut ${formatUnits(minOut, Number(baseDecimals))} (${slippageBps} bps), gas estimate ${swapGas}`);
  const swapHash = await wallet.writeContract({ address: router, abi: routerAbi, functionName: "anyToAnySwap", args: swapArgs(minOut), gas: withBuffer(swapGas) });
  const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
  if (swapReceipt.status !== "success") throw new Error(`swap reverted: ${swapHash}`);
  if (approval && approval.receipt.blockNumber === swapReceipt.blockNumber) throw new Error("approve and swap landed in one block, per-transaction balance deltas are not separable");

  // (e) Everything below is read from the receipt, its logs, and chain state at the receipt's block and the one before.
  const block = swapReceipt.blockNumber;
  const routerEvents = parseEventLogs({ abi: routerAbi, logs: swapReceipt.logs, eventName: "KuruRouterSwap" });
  const trades = parseEventLogs({ abi: orderBookAbi, logs: swapReceipt.logs.filter((l) => l.address.toLowerCase() === market.toLowerCase()), eventName: "Trade" });
  const [quoteBefore, quoteAfter, allowanceAfterSwap, bookBefore] = await Promise.all([
    publicClient.readContract({ address: quoteAsset, abi: erc20Abi, functionName: "balanceOf", args: [owner.address], blockNumber: block - 1n }),
    publicClient.readContract({ address: quoteAsset, abi: erc20Abi, functionName: "balanceOf", args: [owner.address], blockNumber: block }),
    publicClient.readContract({ address: quoteAsset, abi: erc20Abi, functionName: "allowance", args: [owner.address, router], blockNumber: block }),
    book(block - 1n),
  ]);
  const allowanceBeforeSwap = await publicClient.readContract({ address: quoteAsset, abi: erc20Abi, functionName: "allowance", args: [owner.address, router], blockNumber: block - 1n });
  const quoteIn = quoteBefore - quoteAfter;
  let baseOut: bigint;
  if (baseAsset === zeroAddress) {
    if (routerEvents.length !== 1) throw new Error(`expected one KuruRouterSwap event, found ${routerEvents.length}; native output cannot be separated from gas`);
    baseOut = routerEvents[0]!.args.amountOut;
  } else {
    const [b0, b1] = await Promise.all([
      publicClient.readContract({ address: baseAsset, abi: erc20Abi, functionName: "balanceOf", args: [owner.address], blockNumber: block - 1n }),
      publicClient.readContract({ address: baseAsset, abi: erc20Abi, functionName: "balanceOf", args: [owner.address], blockNumber: block }),
    ]);
    baseOut = b1 - b0;
  }
  const swap = await measure(swapHash, baseAsset === zeroAddress ? baseOut : 0n);
  // Gross base filled across all book fills, before any taker fee, from the market's own Trade events.
  const grossFilled = (trades.reduce((sum, t) => sum + t.args.filledSize, 0n) * 10n ** baseDecimals) / sizePrecision;

  const quoteInUnits = Number(formatUnits(quoteIn, Number(quoteDecimals)));
  const baseOutUnits = Number(formatUnits(baseOut, Number(baseDecimals)));
  const effective = quoteInUnits / baseOutUnits;
  const ask = price(bookBefore.ask)!;
  const vsAskBps = bps(effective / ask - 1);
  const vsMidBps = bookBefore.mid === null ? null : bps(effective / bookBefore.mid - 1);
  const impliedFeeBps = trades.length > 0 && grossFilled > 0n ? bps(Number(grossFilled - baseOut) / Number(grossFilled)) : null;
  const usd = (wei: bigint) => (monUsd === null ? null : Number(formatUnits(wei, 18)) * monUsd);
  const chargedTotal = swap.charged + (approval?.charged ?? 0n);
  const chargeRule = (m: Measured) => (m.charged === m.atLimit ? "gas limit" : m.charged === m.atUsed ? "gas used" : "neither, see raw values");

  const row = (name: string, m: Measured) =>
    `| ${name} | ${m.receipt.transactionHash} | ${m.receipt.blockNumber} | ${m.gasLimit} | ${m.receipt.gasUsed} | ${formatUnits(m.receipt.effectiveGasPrice, 9)} | ${formatUnits(m.atUsed, 18)} | ${formatUnits(m.atLimit, 18)} | ${formatUnits(m.charged, 18)} | ${chargeRule(m)} | ${usd(m.charged)?.toFixed(6) ?? "-"} |`;
  console.log(`\nMeasured on Monad testnet (chain 10143), ${pair} market ${market} via router ${router}. MON/USD ${monUsd} from ${monUsdSource}.`);
  console.log("\n| tx | hash | block | gas limit | gas used | effective gas price (gwei) | used x price (MON) | limit x price (MON) | charged, observed (MON) | charged by | charged (USD) |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|");
  if (approval) console.log(row("approve", approval));
  console.log(row("swap", swap));

  console.log("\n| measure | value |\n|---|---|");
  console.log(`| on-chain takerFeeBps / makerFeeBps | ${takerFeeBps} / ${makerFeeBps} |`);
  console.log(`| ${quoteSymbol} in (balance delta) | ${formatUnits(quoteIn, Number(quoteDecimals))} |`);
  console.log(`| ${baseSymbol} out (${baseAsset === zeroAddress ? "KuruRouterSwap amountOut, reconciled against native balance below" : "balance delta"}) | ${formatUnits(baseOut, Number(baseDecimals))} |`);
  console.log(`| quote / minAmountOut | ${formatUnits(quote, Number(baseDecimals))} / ${formatUnits(minOut, Number(baseDecimals))} |`);
  console.log(`| Trade events / gross base filled | ${trades.length} / ${formatUnits(grossFilled, Number(baseDecimals))} |`);
  console.log(`| implied fee from fills (bps) | ${impliedFeeBps ?? "n/a, no Trade events decoded"} |`);
  console.log(`| best bid / best ask before swap (block ${block - 1n}) | ${price(bookBefore.bid) ?? "none"} / ${ask} |`);
  console.log(`| effective price (${quoteSymbol} per ${baseSymbol}) | ${effective} |`);
  console.log(`| cost vs best ask (bps) | ${vsAskBps} |`);
  console.log(`| cost vs mid, fee plus slippage (bps) | ${vsMidBps ?? "n/a, one side of the book is empty"} |`);
  console.log(`| router allowance before / after swap | ${formatUnits(allowanceBeforeSwap, Number(quoteDecimals))} / ${formatUnits(allowanceAfterSwap, Number(quoteDecimals))} |`);
  console.log(`| gas per trade, swap only / with approve (USD) | ${usd(swap.charged)?.toFixed(6)} / ${usd(chargedTotal)?.toFixed(6)} |`);

  console.log(`\nfee + slippage: measured ${vsMidBps ?? `n/a vs mid, ${vsAskBps} vs best ask`} bps against the ${ASSUMED_COST_BPS} bps assumption; on-chain taker fee ${takerFeeBps} bps against the 10 bps assumed fee component`);
  console.log(`gas: measured $${usd(swap.charged)?.toFixed(6)} (swap) and $${usd(chargedTotal)?.toFixed(6)} (with approve) against the $${ASSUMED_GAS_USD} assumption`);
  console.log(`allowance: the router pulled ${formatUnits(allowanceBeforeSwap - allowanceAfterSwap, Number(quoteDecimals))} ${quoteSymbol} of allowance for ${formatUnits(quoteIn, Number(quoteDecimals))} ${quoteSymbol} spent`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
