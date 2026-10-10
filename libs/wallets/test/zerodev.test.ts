import assert from "node:assert/strict";
import { test } from "node:test";
import { CallType } from "@zerodev/permissions/policies";
import { KernelV3AccountAbi } from "@zerodev/sdk";
import {
  concat,
  custom,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  getAddress,
  parseAbiParameters,
  recoverTypedDataAddress,
  toFunctionSelector,
  zeroAddress,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { entryPoint07Abi } from "viem/account-abstraction";
import {
  APPROVE_SELECTOR,
  ScopeError,
  ZeroDevChain,
  buildScope,
  loadWalletsConfig,
  maxOperationCost,
  permissionValidationId,
  sessionPolicies,
  spendPolicyAbi,
  WalletsConfigError,
  type PermissionState,
} from "../src/index.js";

// Offline tests of the ZeroDev adapter against the installed SDK. Every RPC is answered by a mock transport;
// nothing leaves the process.

const USDC = getAddress("0x00000000000000000000000000000000000000a1");
const ROUTER = getAddress("0x00000000000000000000000000000000000000b1");
const REALLOC = getAddress("0x00000000000000000000000000000000000000c1");
const POLICY = getAddress("0x00000000000000000000000000000000000000e1");
const scope = buildScope({ settlementAsset: USDC, kuruRouter: ROUTER, kuruRouterSelectors: ["0x12345678"], reallocation: REALLOC, reallocationSelectors: ["0x9abcdef0"] });
const spendPolicy = { address: POLICY, policyData: "0x" as Hex, hookData: "0x00" as Hex };

type Handler = (method: string, params: unknown[]) => unknown;
function chainWith(handler: Handler, calls: string[] = []) {
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      calls.push(method);
      if (method === "eth_chainId") return `0x${monadTestnet.id.toString(16)}`;
      return handler(method, (params ?? []) as unknown[]);
    },
  });
  return new ZeroDevChain({
    chain: monadTestnet, rpcUrl: "http://unused.invalid", bundlerUrl: "http://unused.invalid", paymasterUrl: null,
    spendPolicy, scope, transport: { rpc: transport, bundler: transport, paymaster: transport },
  });
}
const offline = (calls: string[] = []) => chainWith((method) => { throw new Error(`unexpected RPC ${method}`); }, calls);

const selectorOf = (name: "currentNonce" | "validNonceFrom" | "validationConfig") => toFunctionSelector(KernelV3AccountAbi.find((f) => f.type === "function" && f.name === name) as never);

test("the account address is derived locally, deterministically, and differs per owner and index", async () => {
  const calls: string[] = [];
  const chain = offline(calls);
  const owner = privateKeyToAccount(generatePrivateKey()).address;
  const a0 = await chain.accountAddress(owner, 0n);
  assert.equal(await chain.accountAddress(owner, 0n), a0);
  assert.notEqual(await chain.accountAddress(owner, 1n), a0);
  assert.notEqual(await chain.accountAddress(privateKeyToAccount(generatePrivateKey()).address, 0n), a0);
  assert.deepEqual(calls.filter((m) => m !== "eth_chainId"), []);
});

test("the session policies are the exact allowlist as a call policy plus the spend policy contract", () => {
  const [callPolicy, custom, ...rest] = sessionPolicies(scope, spendPolicy);
  assert.equal(rest.length, 0);
  assert.equal(callPolicy!.policyParams.type, "call");
  const permissions = (callPolicy!.policyParams as unknown as { permissions: { target: string; selector: string; valueLimit: bigint; callType: string; rules: unknown[] }[] }).permissions;
  assert.deepEqual(permissions.map((p) => [p.target, p.selector, p.valueLimit, p.callType, p.rules.length]),
    scope.map((c) => [c.target, c.selector, 0n, CallType.CALL, 0]));
  assert.equal(custom!.getPolicyInfoInBytes().toLowerCase(), concat(["0x0000", POLICY]).toLowerCase());
  assert.equal(custom!.getPolicyData(), "0x");
});

test("configuration calls set the limits and allow exactly the scope on the spend policy", () => {
  const calls = offline().configurationCalls(scope, { perTxCap: 7n, dailyCap: 70n });
  assert.ok(calls.every((c) => c.to === POLICY && c.value === 0n));
  const decoded = calls.map((c) => decodeFunctionData({ abi: spendPolicyAbi, data: c.data }));
  assert.deepEqual(decoded[0], { functionName: "setLimits", args: [{ perTxCap: 7n, dailyCap: 70n }] });
  assert.deepEqual(decoded.slice(1).map((d) => d.args), scope.map((c) => [c.target, c.selector, true]));
});

test("a traded asset is marked with setTradedAsset before its approve is allowed", () => {
  const WETH = "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242";
  const withBase = buildScope({ settlementAsset: USDC, kuruRouter: ROUTER, kuruRouterSelectors: ["0x12345678"], reallocation: REALLOC, reallocationSelectors: ["0x9abcdef0"], tradedAssets: [WETH] });
  const decoded = offline().configurationCalls(withBase, { perTxCap: 7n, dailyCap: 70n }).map((c) => decodeFunctionData({ abi: spendPolicyAbi, data: c.data }));
  assert.deepEqual(decoded.map((d) => d.functionName), ["setLimits", "setTradedAsset", ...withBase.map(() => "setAllowed")]);
  assert.deepEqual(decoded[1]!.args, [WETH, true]);
  assert.deepEqual(decoded.at(-1)!.args, [WETH, APPROVE_SELECTOR, true]);
});

test("the owner's enable signature covers the scoped validator and names the spend policy as hook", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const chain = chainWith((method, params) => {
    if (method === "eth_call") {
      const data = (params[0] as { data: Hex }).data;
      if (data.startsWith(selectorOf("currentNonce"))) return encodeFunctionResult({ abi: KernelV3AccountAbi, functionName: "currentNonce", result: 3 });
      return "0x"; // undeployed account: no code answers
    }
    throw new Error(`unexpected RPC ${method}`);
  });
  const account = await chain.accountAddress(owner.address, 0n);
  const sessionKey = privateKeyToAccount(generatePrivateKey()).address;
  const approval = await chain.approveSession({ owner: { address: owner.address, signer: owner }, index: 0n, account, sessionKeyAddress: sessionKey });
  assert.equal(approval.enableNonce, 3);

  // Rebuild the Kernel v3.1 Enable typed data independently and check the owner signed exactly it.
  const policies = sessionPolicies(scope, spendPolicy);
  const signerData = concat(["0x0000", "0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF", sessionKey]);
  const validatorData = encodeAbiParameters([{ type: "bytes[]" }], [[...policies.map((p) => concat([p.getPolicyInfoInBytes(), p.getPolicyData()])), signerData]]);
  const recovered = await recoverTypedDataAddress({
    domain: { name: "Kernel", version: "0.3.1", chainId: monadTestnet.id, verifyingContract: account },
    types: { Enable: [
      { name: "validationId", type: "bytes21" }, { name: "nonce", type: "uint32" }, { name: "hook", type: "address" },
      { name: "validatorData", type: "bytes" }, { name: "hookData", type: "bytes" }, { name: "selectorData", type: "bytes" },
    ] },
    primaryType: "Enable",
    message: {
      validationId: permissionValidationId(approval.permissionId),
      nonce: 3,
      hook: POLICY,
      validatorData,
      hookData: "0x00",
      selectorData: concat(["0xe9ae5c53", zeroAddress, zeroAddress, encodeAbiParameters(parseAbiParameters("bytes, bytes"), ["0xff", "0x0000"])]),
    },
    signature: approval.enableSignature,
  });
  assert.equal(recovered, owner.address);
});

test("permission state is read from the Kernel account", async () => {
  const chain = chainWith((method, params) => {
    const data = (params[0] as { data: Hex }).data;
    if (data.startsWith(selectorOf("currentNonce"))) return encodeFunctionResult({ abi: KernelV3AccountAbi, functionName: "currentNonce", result: 5 });
    if (data.startsWith(selectorOf("validNonceFrom"))) return encodeFunctionResult({ abi: KernelV3AccountAbi, functionName: "validNonceFrom", result: 5 });
    if (data.startsWith(selectorOf("validationConfig"))) {
      const [vId] = decodeAbiParameters(parseAbiParameters("bytes21"), `0x${data.slice(10)}`);
      assert.equal(vId, permissionValidationId("0xdeadbeef"));
      return encodeFunctionResult({ abi: KernelV3AccountAbi, functionName: "validationConfig", result: { nonce: 4, hook: POLICY } });
    }
    throw new Error(`unexpected ${method}`);
  });
  const state = await chain.permissionState(USDC, "0xdeadbeef");
  assert.deepEqual(state, { installed: true, validatorNonce: 4, currentNonce: 5, validNonceFrom: 5 });
});

test("revocation uninstalls an installed validator and always invalidates the Kernel nonce", async () => {
  const chain = offline();
  const owner = privateKeyToAccount(generatePrivateKey()).address;
  const account = await chain.accountAddress(owner, 0n);
  const sessionKey = privateKeyToAccount(generatePrivateKey()).address;
  const approvalChain = chainWith((method) => { if (method === "eth_call") return "0x"; throw new Error(method); });
  const ownerAccount = privateKeyToAccount(generatePrivateKey());
  const ownerAddr = await approvalChain.accountAddress(ownerAccount.address, 0n);
  const { permissionId } = await approvalChain.approveSession({ owner: { address: ownerAccount.address, signer: ownerAccount }, index: 0n, account: ownerAddr, sessionKeyAddress: sessionKey });

  const installed: PermissionState = { installed: true, validatorNonce: 1, currentNonce: 1, validNonceFrom: 0 };
  const calls = await chain.revocationCalls({ account, sessionKeyAddress: sessionKey, permissionId, state: installed });
  assert.ok(calls.every((c) => c.to === account && c.value === 0n));
  const decoded = calls.map((c) => decodeFunctionData({ abi: KernelV3AccountAbi, data: c.data }));
  assert.equal(decoded[0]!.functionName, "uninstallValidation");
  assert.equal((decoded[0]!.args as readonly unknown[])[0], permissionValidationId(permissionId));
  assert.deepEqual([decoded[1]!.functionName, decoded[1]!.args], ["invalidateNonce", [2]]);

  const never = await chain.revocationCalls({ account, sessionKeyAddress: sessionKey, permissionId, state: { ...installed, installed: false } });
  assert.deepEqual(never.map((c) => decodeFunctionData({ abi: KernelV3AccountAbi, data: c.data }).functionName), ["invalidateNonce"]);
  await assert.rejects(chain.revocationCalls({ account, sessionKeyAddress: owner, permissionId, state: installed }), /permission ID/);
});

test("the worst-case cost covers every gas limit, the paymaster's included", () => {
  assert.equal(maxOperationCost({ callGasLimit: 1n, verificationGasLimit: 2n, preVerificationGas: 3n, maxFeePerGas: 10n }), 60n);
  assert.equal(maxOperationCost({ callGasLimit: 1n, verificationGasLimit: 2n, preVerificationGas: 3n, paymasterVerificationGasLimit: 4n, paymasterPostOpGasLimit: 5n, maxFeePerGas: 10n }), 150n);
});

test("configuration is read from the environment and rejects anything but Monad testnet", () => {
  const env = {
    WALLETS_CHAIN_ID: "10143",
    WALLETS_BUNDLER_URL: "https://bundler.example/chain/10143",
    WALLETS_SPEND_POLICY_ADDRESS: POLICY,
    WALLETS_SETTLEMENT_ASSET: USDC,
    WALLETS_KURU_ROUTER: ROUTER,
    WALLETS_KURU_ROUTER_SELECTORS: "0x12345678",
    WALLETS_REALLOCATION_CONTRACT: REALLOC,
    WALLETS_REALLOCATION_SELECTORS: "0x9abcdef0",
    WALLETS_SPONSORED_OPERATIONS: "5",
    WALLETS_SPONSORED_GAS_WEI: "1000000000000000000",
  };
  const config = loadWalletsConfig(env);
  assert.equal(config.chain.paymasterUrl, null);
  assert.deepEqual([config.chain.spendPolicy.policyData, config.chain.spendPolicy.hookData], ["0x", "0x00"]);
  assert.throws(() => loadWalletsConfig({ ...env, WALLETS_SPEND_POLICY_HOOK_DATA: "0x" }), WalletsConfigError);
  assert.deepEqual(config.budget, { operations: 5, gasWei: 10n ** 18n });
  assert.deepEqual(config.chain.scope, scope);
  assert.throws(() => loadWalletsConfig({ ...env, WALLETS_CHAIN_ID: "143" }), WalletsConfigError);
  assert.throws(() => loadWalletsConfig({ ...env, WALLETS_BUNDLER_URL: "http://bundler.example" }), WalletsConfigError);
  assert.throws(() => loadWalletsConfig({ ...env, WALLETS_SPEND_POLICY_ADDRESS: undefined }), WalletsConfigError);
  assert.throws(() => loadWalletsConfig({ ...env, WALLETS_SPONSORED_GAS_WEI: "-1" }), WalletsConfigError);
  const WETH = "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242";
  const traded = loadWalletsConfig({ ...env, WALLETS_TRADED_ASSETS: ` ${WETH} ` }).chain.scope.filter((c) => c.label === "traded-asset");
  assert.deepEqual(traded.map((c) => [c.target, c.selector]), [[WETH, APPROVE_SELECTOR]]);
  assert.throws(() => loadWalletsConfig({ ...env, WALLETS_TRADED_ASSETS: "weth" }), WalletsConfigError);
  assert.throws(() => loadWalletsConfig({ ...env, WALLETS_TRADED_ASSETS: USDC }), ScopeError);
});

test("bundler reads map to the full receipt, pending state, and the EntryPoint nonce for the operation's key", async () => {
  const hash = `0x${"11".repeat(32)}` as Hex;
  const tx = `0x${"22".repeat(32)}` as Hex;
  const topic = `0x${"33".repeat(32)}` as Hex;
  let held: "none" | "pool" | "mined" = "none";
  const key = 5n;
  const chain = chainWith((method, params) => {
    if (method === "eth_getUserOperationReceipt") {
      if (held !== "mined") return null;
      return {
        userOpHash: hash, sender: USDC, nonce: "0x0", actualGasCost: "0x64", actualGasUsed: "0x10", success: false, reason: "0xdead",
        paymaster: POLICY,
        logs: [{ address: ROUTER, topics: [topic], data: "0x01", blockNumber: "0x7", transactionHash: tx, logIndex: "0x0", blockHash: tx, transactionIndex: "0x0", removed: false }],
        receipt: { transactionHash: tx, blockNumber: "0x7", blockHash: tx, status: "0x1", logs: [], gasUsed: "0x10", cumulativeGasUsed: "0x10", effectiveGasPrice: "0x1", transactionIndex: "0x0", type: "0x2", from: USDC, to: ROUTER, logsBloom: "0x", contractAddress: null },
      };
    }
    if (method === "eth_getUserOperationByHash") return held === "pool" ? { userOperation: {}, blockNumber: null } : null;
    if (method === "eth_call") {
      const data = (params[0] as { data: Hex }).data;
      const [, k] = decodeFunctionData({ abi: entryPoint07Abi, data }).args as readonly unknown[] as [Hex, bigint];
      assert.equal(k, key);
      return encodeFunctionResult({ abi: entryPoint07Abi, functionName: "getNonce", result: (key << 64n) | 3n });
    }
    throw new Error(`unexpected ${method}`);
  });
  assert.equal(await chain.getReceipt(hash), null);
  assert.equal(await chain.isPending(hash), false);
  held = "pool";
  assert.equal(await chain.isPending(hash), true);
  held = "mined";
  const receipt = await chain.getReceipt(hash);
  assert.deepEqual(receipt, {
    success: false, actualGasCost: 100n, sponsored: true, transactionHash: tx, blockNumber: 7n,
    logs: [{ address: ROUTER, topics: [topic], data: "0x01" }], revertReason: "0xdead",
  });
  assert.equal(await chain.nextNonce(USDC, (key << 64n) | 2n), (key << 64n) | 3n);
});
