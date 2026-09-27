// Issue #18 spike. Throwaway code: it answers one question on Monad testnet and is not imported by anything.
// Question: does a ZeroDev session key with call policy (per-call cap X) plus the reset rate limit
// (N UserOps per window) bound native spend at N * X per window, and does a batched UserOp break that bound?
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
const capPerCall = parseEther(env("CAP_PER_CALL_MON", "0.001"));
const count = Number(env("RATE_LIMIT_COUNT", "3"));
const windowSeconds = Number(env("WINDOW_SECONDS", "120"));
const fundTarget = parseEther(env("FUND_MON", "0.05"));

const chain = monadTestnet;
const entryPoint = getEntryPoint("0.7");
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const owner = privateKeyToAccount(env("OWNER_PRIVATE_KEY") as Hex);
// ponytail: the session key is generated per run and never persisted, which is enough for a spike
const sessionKey = privateKeyToAccount(generatePrivateKey());
const recipient = owner.address;

type Outcome = { step: string; expected: "ok" | "reject"; actual: "ok" | "reject"; moved: bigint; detail: string };
const outcomes: Outcome[] = [];

async function attempt(
  client: KernelAccountClient,
  step: string,
  expected: "ok" | "reject",
  calls: { to: Hex; value: bigint; data: Hex }[],
) {
  const moved = calls.reduce((sum, call) => sum + call.value, 0n);
  try {
    const hash = await client.sendUserOperation({ callData: await client.account!.encodeCalls(calls) });
    const receipt = await client.waitForUserOperationReceipt({ hash });
    const ok = receipt.success;
    outcomes.push({ step, expected, actual: ok ? "ok" : "reject", moved: ok ? moved : 0n, detail: receipt.receipt.transactionHash });
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0]!.slice(0, 160) : String(error);
    outcomes.push({ step, expected, actual: "reject", moved: 0n, detail });
  }
  const last = outcomes.at(-1)!;
  console.log(`${last.actual === expected ? "PASS" : "UNEXPECTED"} ${step}: ${last.actual} (${last.detail})`);
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

  // 1. Per-call cap. Validation failures should not consume the rate limit.
  await attempt(session, "single transfer above per-call cap", "reject", single(capPerCall + 1n));
  // 2. The open question: does one batched UserOp with two capped calls count once against the rate limit?
  await attempt(session, "batch of two capped calls in one UserOp", "reject", [...single(capPerCall), ...single(capPerCall)]);
  // 3. Exhaust the window with capped single calls, then one more that must be rejected.
  for (let i = 1; i <= count; i++) await attempt(session, `capped single transfer ${i}`, "ok", single(capPerCall));
  await attempt(session, "single transfer after window exhausted", "reject", single(capPerCall));
  // 4. Reset: after the interval, the allowance should refill.
  console.log(`waiting ${windowSeconds + 5}s for the window to reset`);
  await new Promise((resolve) => setTimeout(resolve, (windowSeconds + 5) * 1000));
  await attempt(session, "single transfer after window reset", "ok", single(capPerCall));

  const firstWindow = outcomes.slice(0, -1).reduce((sum, outcome) => sum + outcome.moved, 0n);
  const bound = capPerCall * BigInt(count);
  console.log("\n| step | expected | actual | detail |\n|---|---|---|---|");
  for (const o of outcomes) console.log(`| ${o.step} | ${o.expected} | ${o.actual} | ${o.detail} |`);
  console.log(`\nmoved in first window: ${formatEther(firstWindow)} MON, bound N * X: ${formatEther(bound)} MON`);
  console.log(firstWindow > bound ? "RESULT: bound broken, the workaround does not cap daily spend" : "RESULT: bound held");
  process.exit(outcomes.every((o) => o.actual === o.expected) ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
