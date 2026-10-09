// Issue #19 spike, server side. Throwaway code: it answers one question on Monad testnet and is not imported by anything.
// It plays the agent worker: it generates a session key in memory, gives the browser only the key's address,
// receives the owner's serialized approval, sends UserOps with the session key, and after the owner revokes,
// tries again and records the rejection. Every result row is measured from chain state or a receipt.
import { createKernelAccountClient, type KernelAccountClient } from "@zerodev/sdk";
import { VALIDATOR_TYPE } from "@zerodev/sdk/constants";
import { getValidatorAddress } from "@zerodev/ecdsa-validator";
import { deserializePermissionAccount } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import {
  concatHex,
  createPublicClient,
  formatEther,
  http,
  isAddress,
  isAddressEqual,
  pad,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  CAP_PER_CALL,
  CHAIN_ID,
  SERVER_HOST,
  SERVER_PORT,
  TEST_TRANSFER,
  WEB_ORIGIN,
  assertTestnetBundler,
  chain,
  entryPoint,
  kernelVersion,
  type ApprovalRequest,
  type RevokedRequest,
  type ServerReply,
} from "./src/config";

const bundlerUrl = assertTestnetBundler(process.env.VITE_ZERODEV_RPC);
const rpcUrl = process.env.MONAD_RPC ?? "https://testnet-rpc.monad.xyz";
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
// Generated per run, held in memory only, never logged, never sent anywhere. Only its address leaves this process.
const sessionKey = privateKeyToAccount(generatePrivateKey());

const kernelAbi = parseAbi([
  "function rootValidator() view returns (bytes21)",
  "function validationConfig(bytes21 vId) view returns ((uint32 nonce, address hook))",
]);
const ecdsaValidatorAbi = parseAbi(["function ecdsaValidatorStorage(address) view returns (address owner)"]);

type Row = { step: string; expected: string; actual: string; block: string; gas: string; detail: string };
const rows: Row[] = [];
let session: { owner: Address; account: Address; approval: string; client: KernelAccountClient; vId: Hex } | null = null;
let phase: "await-approval" | "await-revoke" | "done" = "await-approval";

function record(row: Row) {
  rows.push(row);
  const verdict = row.expected === "observe" ? "OBSERVED" : row.actual === row.expected ? "PASS" : "UNEXPECTED";
  console.log(`${verdict} ${row.step}: ${row.actual} ${row.detail}`);
}

function table(): string {
  const head = "| step | expected | actual | block | gas paid (MON) | detail |\n|---|---|---|---:|---:|---|";
  return [head, ...rows.map((r) => `| ${r.step} | ${r.expected} | ${r.actual} | ${r.block} | ${r.gas} | ${r.detail} |`)].join("\n");
}

/** First line of an error, with the bundler URL (it carries the ZeroDev project ID) and pipes removed. */
function brief(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0]!.replaceAll(bundlerUrl, "<bundler>").replaceAll("|", "/").slice(0, 200);
}

function clientFor(account: Awaited<ReturnType<typeof deserializePermissionAccount>>): KernelAccountClient {
  // No paymaster: the account pays its own gas, as in the rolling daily cap spike.
  return createKernelAccountClient({ account, chain, bundlerTransport: http(bundlerUrl), client: publicClient });
}

/** Sends one UserOp and records the outcome. A bundler rejection costs nothing; an on-chain revert pays gas. */
async function attempt(client: KernelAccountClient, step: string, expected: "ok" | "reject", to: Address, value: bigint) {
  const owner = session!.owner;
  const before = await publicClient.getBalance({ address: owner });
  try {
    const hash = await client.sendUserOperation({ callData: await client.account!.encodeCalls([{ to, value, data: "0x" }]) });
    const receipt = await client.waitForUserOperationReceipt({ hash });
    const block = receipt.receipt.blockNumber;
    const moved = (await publicClient.getBalance({ address: owner, blockNumber: block })) - before;
    record({
      step,
      expected,
      actual: receipt.success ? "ok" : "reject",
      block: block.toString(),
      gas: formatEther(receipt.actualGasCost),
      detail: `owner balance change ${formatEther(moved)} MON, tx ${receipt.receipt.transactionHash}`,
    });
  } catch (error) {
    const moved = (await publicClient.getBalance({ address: owner })) - before;
    record({ step, expected, actual: "reject", block: "-", gas: "0", detail: `owner balance change ${formatEther(moved)} MON, ${brief(error)}` });
  }
}

async function permissionInstalled(account: Address, vId: Hex): Promise<boolean> {
  const config = await publicClient.readContract({ address: account, abi: kernelAbi, functionName: "validationConfig", args: [vId] });
  return config.hook !== "0x0000000000000000000000000000000000000000";
}

async function onApproval(body: ApprovalRequest): Promise<void> {
  if (!isAddress(body.owner) || !isAddress(body.account) || typeof body.approval !== "string") throw new Error("malformed approval request");
  const account = await deserializePermissionAccount(publicClient, entryPoint, kernelVersion, body.approval, await toECDSASigner({ signer: sessionKey }));
  if (!isAddressEqual(account.address, body.account)) throw new Error("approval does not match the account address the owner reported");
  const regular = account.kernelPluginManager.regularValidator;
  if (!regular) throw new Error("approval carries no permission validator");
  const vId = concatHex([VALIDATOR_TYPE.PERMISSION, pad(regular.getIdentifier(), { size: 20, dir: "right" })]);
  session = { owner: body.owner, account: account.address, approval: body.approval, client: clientFor(account), vId };
  record({ step: "approval deserialized with the server-held session key", expected: "ok", actual: "ok", block: "-", gas: "-", detail: `account ${account.address}` });

  const codeBefore = await publicClient.getCode({ address: account.address });
  record({ step: "account code before the first session key UserOp", expected: "observe", actual: codeBefore && codeBefore !== "0x" ? "deployed" : "not deployed", block: "-", gas: "-", detail: "counterfactual until the first UserOp" });
  const funded = await publicClient.getBalance({ address: account.address });
  record({ step: "account balance before the first UserOp", expected: "observe", actual: `${formatEther(funded)} MON`, block: "-", gas: "-", detail: "funded by the owner from the page" });

  // The first UserOp deploys the account (initCode) and enables the permission validator (enable mode) in one go.
  await attempt(session.client, `session key transfer of ${formatEther(TEST_TRANSFER)} MON to owner`, "ok", body.owner, TEST_TRANSFER);

  const codeAfter = await publicClient.getCode({ address: account.address });
  const deployed = Boolean(codeAfter && codeAfter !== "0x");
  record({ step: "account deployed", expected: "yes", actual: deployed ? "yes" : "no", block: "-", gas: "-", detail: `code size ${codeAfter ? (codeAfter.length - 2) / 2 : 0} bytes` });
  if (deployed) {
    const validator = getValidatorAddress(entryPoint, kernelVersion);
    const root = await publicClient.readContract({ address: account.address, abi: kernelAbi, functionName: "rootValidator" });
    const rootOk = root.toLowerCase() === concatHex([VALIDATOR_TYPE.SECONDARY, validator]).toLowerCase();
    const onchainOwner = await publicClient.readContract({ address: validator, abi: ecdsaValidatorAbi, functionName: "ecdsaValidatorStorage", args: [account.address] });
    const ownerOk = rootOk && isAddressEqual(onchainOwner, body.owner);
    record({ step: "root validator is ECDSA, owned by the Privy embedded wallet", expected: "yes", actual: ownerOk ? "yes" : "no", block: "-", gas: "-", detail: `root ${root}, owner ${onchainOwner}` });
    const installed = await permissionInstalled(account.address, vId);
    record({ step: "permission validator installed", expected: "yes", actual: installed ? "yes" : "no", block: "-", gas: "-", detail: `vId ${vId}` });
  }

  // Scope checks: both are expected to fail validation in the bundler's simulation, so they pay no gas.
  await attempt(session.client, "session key transfer above the per-call cap", "reject", body.owner, CAP_PER_CALL + 1n);
  await attempt(session.client, "session key transfer to a target outside the policy", "reject", sessionKey.address, 1n);
  phase = "await-revoke";
}

async function onRevoked(body: RevokedRequest): Promise<void> {
  if (!session) throw new Error("no approval received yet");
  if (typeof body.userOpHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.userOpHash)) throw new Error("malformed userOpHash");
  const receipt = await session.client.waitForUserOperationReceipt({ hash: body.userOpHash });
  record({
    step: "owner uninstalls the permission validator (Privy-signed UserOp)",
    expected: "ok",
    actual: receipt.success && isAddressEqual(receipt.sender, session.account) ? "ok" : "reject",
    block: receipt.receipt.blockNumber.toString(),
    gas: formatEther(receipt.actualGasCost),
    detail: `tx ${receipt.receipt.transactionHash}`,
  });
  const installed = await permissionInstalled(session.account, session.vId);
  record({ step: "permission validator installed after revoke", expected: "no", actual: installed ? "yes" : "no", block: "-", gas: "-", detail: `vId ${session.vId}` });

  // Two retries. The first reuses the client that already sent UserOps. The second deserializes the stored approval
  // again, so the SDK sees the validator as not installed and replays the owner's enable signature: this checks that
  // a revoked key cannot re-enable itself with the approval it still holds.
  await attempt(session.client, "revoked session key, existing client", "reject", session.owner, TEST_TRANSFER);
  const fresh = await deserializePermissionAccount(publicClient, entryPoint, kernelVersion, session.approval, await toECDSASigner({ signer: sessionKey }));
  await attempt(clientFor(fresh), "revoked session key, approval re-deserialized (enable replay)", "reject", session.owner, TEST_TRANSFER);
  phase = "done";
}

function json(reply: ServerReply, status = 200): Response {
  return new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
}

async function readBody<T>(req: Request): Promise<T> {
  const text = await req.text();
  if (text.length > 64_000) throw new Error("request body too large");
  return JSON.parse(text) as T;
}

async function main() {
  const chainId = await publicClient.getChainId();
  if (chainId !== CHAIN_ID) throw new Error(`MONAD_RPC returned chain ${chainId}, expected ${CHAIN_ID}`);
  console.log(`chain ${chainId} confirmed`);
  console.log(`session key address ${sessionKey.address} (private key held in memory only)`);

  let busy = false;
  Bun.serve({
    hostname: SERVER_HOST,
    port: SERVER_PORT,
    async fetch(req) {
      // Only the spike page, through the Vite proxy, may call this server. A request carrying any other Origin is refused.
      const origin = req.headers.get("origin");
      if (origin !== null && origin !== WEB_ORIGIN) return json({ ok: false, table: "", error: "origin not allowed" }, 403);
      const path = new URL(req.url).pathname;
      if (req.method === "GET" && path === "/api/session-key") {
        return new Response(JSON.stringify({ address: sessionKey.address, chainId: CHAIN_ID }), { headers: { "content-type": "application/json" } });
      }
      if (req.method !== "POST" || (path !== "/api/approval" && path !== "/api/revoked")) return json({ ok: false, table: "", error: "not found" }, 404);
      if (busy) return json({ ok: false, table: table(), error: "a step is already running" }, 409);
      busy = true;
      try {
        if (path === "/api/approval") {
          if (phase !== "await-approval") throw new Error("approval already received for this run, restart the server for a new run");
          await onApproval(await readBody<ApprovalRequest>(req));
        } else {
          if (phase !== "await-revoke") throw new Error("not waiting for a revocation");
          await onRevoked(await readBody<RevokedRequest>(req));
          console.log(`\n${table()}\n`);
          const pass = rows.every((r) => r.expected === "observe" || r.expected === r.actual);
          console.log(pass ? "RESULT: every asserted step matched" : "RESULT: at least one step was UNEXPECTED");
        }
        return json({ ok: true, table: table() });
      } catch (error) {
        console.error(`error: ${brief(error)}`);
        return json({ ok: false, table: table(), error: brief(error) }, 400);
      } finally {
        busy = false;
      }
    },
  });
  console.log(`listening on http://${SERVER_HOST}:${SERVER_PORT}, open ${WEB_ORIGIN}`);
}

main().catch((error) => {
  console.error(brief(error));
  process.exit(1);
});
