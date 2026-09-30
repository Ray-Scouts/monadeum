// Issue #18 spike. Throwaway code: it answers one question on Monad testnet and is not imported by anything.
// Question: does a ZeroDev session key with call policy (per-call cap X) plus the reset rate limit
// (N UserOps per window) bound native spend at N * X per window, does a batched UserOp break that bound,
// and how much can move inside any window-length span, not only inside one fixed window?
import {
  createKernelAccount,
  createKernelAccountClient,
  type KernelAccountClient,
} from "@zerodev/sdk";
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { RATE_LIMIT_POLICY_WITH_RESET_CONTRACT, toPermissionValidator } from "@zerodev/permissions";
import { CallPolicyVersion, toCallPolicy, toRateLimitPolicy } from "@zerodev/permissions/policies";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is not set, see .env.example`);
  return value;
};

const bundlerUrl = env("ZERODEV_RPC");
if (!bundlerUrl.includes("/chain/10143")) throw new Error("ZERODEV_RPC must target Monad testnet, chain 10143");
const rpcUrl = env("MONAD_RPC", "https://testnet-rpc.monad.xyz");
const positiveInt = (name: string, fallback: string): number => {
  const value = Number(env(name, fallback));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};
const capPerCall = parseEther(env("CAP_PER_CALL_MON", "0.001"));
if (capPerCall <= 0n) throw new Error("CAP_PER_CALL_MON must be positive");
const count = positiveInt("RATE_LIMIT_COUNT", "3");
const windowSeconds = positiveInt("WINDOW_SECONDS", "120");
const pollSeconds = positiveInt("POLL_SECONDS", "5");
const fundTarget = parseEther(env("FUND_MON", "0.05"));

const chain = monadTestnet;
const entryPoint = getEntryPoint("0.7");
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const owner = privateKeyToAccount(env("OWNER_PRIVATE_KEY") as Hex);
// Generated per run and never persisted. Revocation is out of scope here, see issue #19.
const sessionKey = privateKeyToAccount(generatePrivateKey());
const recipient = owner.address;

// "observe" marks a step whose outcome is the finding itself, not a pass or fail.
type Expected = "ok" | "reject" | "observe";
type Outcome = { step: string; expected: Expected; actual: "ok" | "reject"; moved: bigint; at: bigint | null; detail: string };
const outcomes: Outcome[] = [];

async function chainTime(): Promise<bigint> {
  return (await publicClient.getBlock({ blockTag: "latest" })).timestamp;
}

async function attempt(
  client: KernelAccountClient,
  step: string,
  expected: Expected,
  calls: { to: Hex; value: bigint; data: Hex }[],
): Promise<Outcome> {
  // Moved is measured as the recipient's on-chain balance change, not taken from the requested values.
  // The recipient only receives during the run, so any change is spend from the agent account.
  const before = await publicClient.getBalance({ address: recipient });
  let outcome: Outcome;
  try {
    const hash = await client.sendUserOperation({ callData: await client.account!.encodeCalls(calls) });
    const receipt = await client.waitForUserOperationReceipt({ hash });
    const block = await publicClient.getBlock({ blockNumber: receipt.receipt.blockNumber });
    const moved = (await publicClient.getBalance({ address: recipient, blockNumber: receipt.receipt.blockNumber })) - before;
    const actual = receipt.success ? "ok" : "reject";
    outcome = { step, expected, actual, moved, at: block.timestamp, detail: receipt.receipt.transactionHash };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0]!.slice(0, 160) : String(error);
    outcome = { step, expected, actual: "reject", moved: 0n, at: null, detail };
  }
  outcomes.push(outcome);
  const verdict = expected === "observe" ? "OBSERVED" : outcome.actual === expected ? "PASS" : "UNEXPECTED";
  console.log(`${verdict} ${step}: ${outcome.actual}, moved ${formatEther(outcome.moved)} MON (${outcome.detail})`);
  return outcome;
}

/** Retries one capped transfer until the chain accepts it, which marks a window reset in chain time, not local time. */
async function untilReset(client: KernelAccountClient, label: string, single: (v: bigint) => { to: Hex; value: bigint; data: Hex }[]) {
  const polls = Math.ceil((2 * windowSeconds) / pollSeconds);
  for (let i = 0; i < polls; i++) {
    const before = outcomes.length;
    const o = await attempt(client, `${label}, reset probe ${i + 1}`, "observe", single(capPerCall));
    if (o.actual === "ok") return o;
    // A rejected probe is kept out of the table unless it moved funds, which would itself be a finding.
    if (o.moved === 0n) outcomes.splice(before, 1);
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }
  throw new Error(`${label}: no reset observed within ${2 * windowSeconds}s of chain time`);
}

/** Largest amount moved inside any span of windowSeconds, over the chain timestamps of accepted operations. */
function maxInAnySpan(rows: Outcome[]): bigint {
  const timed = rows.filter((o) => o.at !== null && o.moved > 0n).sort((a, b) => Number(a.at! - b.at!));
  let best = 0n;
  for (let i = 0; i < timed.length; i++) {
    let sum = 0n;
    for (let j = i; j < timed.length && timed[j]!.at! - timed[i]!.at! < BigInt(windowSeconds); j++) sum += timed[j]!.moved;
    if (sum > best) best = sum;
  }
  return best;
}

async function main() {
  const chainId = await publicClient.getChainId();
  if (chainId !== 10143) throw new Error(`MONAD_RPC returned chain ${chainId}, expected 10143`);

  const sudo = await signerToEcdsaValidator(publicClient, { signer: owner, entryPoint, kernelVersion: KERNEL_V3_1 });
  const permission = await toPermissionValidator(publicClient, {
    entryPoint,
    kernelVersion: KERNEL_V3_1,
    signer: await toECDSASigner({ signer: sessionKey }),
    policies: [
      toCallPolicy({ policyVersion: CallPolicyVersion.V0_0_4, permissions: [{ target: recipient, valueLimit: capPerCall }] }),
      toRateLimitPolicy({ policyAddress: RATE_LIMIT_POLICY_WITH_RESET_CONTRACT, count, interval: windowSeconds }),
    ],
  });
  const account = await createKernelAccount(publicClient, {
    entryPoint,
    kernelVersion: KERNEL_V3_1,
    plugins: { sudo, regular: permission },
  });
  // No paymaster: the account pays its own gas, so the result does not depend on a sponsorship policy.
  const session = createKernelAccountClient({ account, chain, bundlerTransport: http(bundlerUrl), client: publicClient });

  console.log(`owner ${owner.address}`);
  console.log(`agent account ${account.address}`);
  console.log(`session key ${sessionKey.address}`);
  console.log(`policy: ${formatEther(capPerCall)} MON per call, ${count} UserOps per ${windowSeconds}s, bound ${formatEther(capPerCall * BigInt(count))} MON per window`);

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance < fundTarget) {
    const wallet = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
    const hash = await wallet.sendTransaction({ to: account.address, value: fundTarget - balance });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`funded agent account with ${formatEther(fundTarget - balance)} MON from owner`);
  }

  const single = (value: bigint) => [{ to: recipient, value, data: "0x" as Hex }];
  const bound = capPerCall * BigInt(count);

  // Phase 1, batching, in its own window so its result cannot disturb the count in phase 2.
  await attempt(session, "single transfer above per-call cap", "reject", single(capPerCall + 1n));
  const batch = await attempt(session, "batch of two capped calls in one UserOp", "observe", [...single(capPerCall), ...single(capPerCall)]);
  let remaining = 0;
  while (remaining <= count) {
    const o = await attempt(session, `phase 1 capped single ${remaining + 1}`, "observe", single(capPerCall));
    if (o.actual !== "ok") break;
    remaining++;
  }
  const phase1 = outcomes.slice();

  // Phase 2, the per-window bound. The reset probe is the window's first accepted operation.
  const reset1 = await untilReset(session, "phase 2", single);
  for (let i = 2; i <= count; i++) await attempt(session, `phase 2 capped single ${i}`, "ok", single(capPerCall));
  await attempt(session, "phase 2 single after window exhausted", "reject", single(capPerCall));

  // Phase 3, the boundary. Spend the next window's allowance late in it, then the one after that as soon as it
  // resets. A rolling cap would reject the second burst; a fixed window allows both inside one window-length span.
  console.log(`phase 2 window opened at chain time ${reset1.at}, waiting for the next reset`);
  const reset2 = await untilReset(session, "phase 3 late", single);
  while ((await chainTime()) < reset2.at! + BigInt(Math.floor(windowSeconds / 2))) {
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }
  for (let i = 2; i <= count; i++) await attempt(session, `phase 3 late capped single ${i}`, "ok", single(capPerCall));
  await untilReset(session, "phase 3 early", single);
  for (let i = 2; i <= count; i++) await attempt(session, `phase 3 early capped single ${i}`, "ok", single(capPerCall));

  const phase1Moved = phase1.reduce((sum, o) => sum + o.moved, 0n);
  const perWindow = outcomes.slice(phase1.length);
  const phase2 = perWindow.filter((o) => o.step.startsWith("phase 2"));
  const phase2Moved = phase2.reduce((sum, o) => sum + o.moved, 0n);
  const rolling = maxInAnySpan(perWindow);

  console.log("\n| step | expected | actual | moved (MON) | block time | detail |\n|---|---|---|---:|---:|---|");
  for (const o of outcomes) {
    console.log(`| ${o.step} | ${o.expected} | ${o.actual} | ${formatEther(o.moved)} | ${o.at ?? "-"} | ${o.detail} |`);
  }
  console.log(`\nbound N * X per window: ${formatEther(bound)} MON`);
  console.log(`batch: ${batch.actual}, moved ${formatEther(batch.moved)} MON; singles accepted after it in the same window: ${remaining}`);
  console.log(`phase 1 window moved ${formatEther(phase1Moved)} MON: ${phase1Moved > bound ? "BATCH BREAKS the per-window bound" : "per-window bound held with batching"}`);
  console.log(`phase 2 window moved ${formatEther(phase2Moved)} MON: ${phase2Moved > bound ? "per-window bound BROKEN" : "per-window bound held"}`);
  console.log(`max moved in any ${windowSeconds}s span: ${formatEther(rolling)} MON: ${rolling > bound ? "the window is FIXED, not rolling" : "no boundary burst observed"}`);
  process.exit(outcomes.every((o) => o.expected === "observe" || o.actual === o.expected) ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
