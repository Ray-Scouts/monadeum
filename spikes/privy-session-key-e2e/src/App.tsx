// Issue #19 spike, owner side. The Privy embedded wallet is the Kernel account's sudo (owner) signer.
// The owner never sees the session key's private key: it builds the permission validator from the key's address only.
import { useState } from "react";
import { usePrivy, useWallets, type ConnectedWallet } from "@privy-io/react-auth";
import { addressToEmptyAccount, createKernelAccount, createKernelAccountClient, type CreateKernelAccountReturnType } from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { serializePermissionAccount, toPermissionValidator } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { createPublicClient, createWalletClient, custom, formatEther, http, isAddressEqual, parseEther, type Account, type Address, type Chain, type Transport, type WalletClient } from "viem";
import {
  CHAIN_ID,
  assertTestnetBundler,
  chain,
  entryPoint,
  kernelVersion,
  sessionPolicies,
  type ApprovalRequest,
  type RevokedRequest,
  type ServerReply,
} from "./config";

const bundlerUrl = assertTestnetBundler(import.meta.env.VITE_ZERODEV_RPC);
const fundAmount = parseEther(import.meta.env.VITE_FUND_MON ?? "2");
const publicClient = createPublicClient({ chain, transport: http(import.meta.env.VITE_MONAD_RPC ?? chain.rpcUrls.default.http[0]) });

type OwnerWallet = WalletClient<Transport, Chain, Account>;
type Owner = {
  wallet: OwnerWallet;
  address: Address;
  sudo: Awaited<ReturnType<typeof signerToEcdsaValidator>>;
  permission: Awaited<ReturnType<typeof toPermissionValidator>>;
  account: CreateKernelAccountReturnType<"0.7">;
};

async function ownerWallet(embedded: ConnectedWallet): Promise<OwnerWallet> {
  await embedded.switchChain(CHAIN_ID);
  const wallet = createWalletClient({ account: embedded.address as Address, chain, transport: custom(await embedded.getEthereumProvider()) });
  // Validate the chain before any write: the embedded wallet must report 10143, and so must the read RPC.
  const [walletChain, rpcChain] = await Promise.all([wallet.getChainId(), publicClient.getChainId()]);
  if (walletChain !== CHAIN_ID || rpcChain !== CHAIN_ID) throw new Error(`chain mismatch: wallet ${walletChain}, rpc ${rpcChain}, expected ${CHAIN_ID}`);
  return wallet;
}

async function post<T>(path: string, body: T): Promise<ServerReply> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as ServerReply;
}

export function App() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const [owner, setOwner] = useState<Owner | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [table, setTable] = useState("");
  const [busy, setBusy] = useState(false);
  const note = (line: string) => setLog((prev) => [...prev, line]);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      note(`error: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const createAccount = run(async () => {
    if (!embedded) throw new Error("no Privy embedded wallet on this user");
    const wallet = await ownerWallet(embedded);
    const address = embedded.address as Address;
    const res = await fetch("/api/session-key");
    const { address: sessionKeyAddress, chainId } = (await res.json()) as { address: Address; chainId: number };
    if (chainId !== CHAIN_ID) throw new Error(`server reports chain ${chainId}`);
    const sudo = await signerToEcdsaValidator(publicClient, { signer: wallet, entryPoint, kernelVersion });
    const permission = await toPermissionValidator(publicClient, {
      entryPoint,
      kernelVersion,
      signer: await toECDSASigner({ signer: addressToEmptyAccount(sessionKeyAddress) }),
      policies: sessionPolicies(address),
    });
    const account = await createKernelAccount(publicClient, { entryPoint, kernelVersion, plugins: { sudo, regular: permission } });
    setOwner({ wallet, address, sudo, permission, account });
    note(`owner ${address}, session key ${sessionKeyAddress}, account ${account.address}`);
    note(`account balance ${formatEther(await publicClient.getBalance({ address: account.address }))} MON`);
  });

  const fund = run(async () => {
    if (!owner || !embedded) return;
    await ownerWallet(embedded);
    const hash = await owner.wallet.sendTransaction({ account: owner.address, chain, to: owner.account.address, value: fundAmount });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    note(`funded ${formatEther(fundAmount)} MON, ${receipt.status}, block ${receipt.blockNumber}, tx ${hash}`);
  });

  const approve = run(async () => {
    if (!owner || !embedded) return;
    await ownerWallet(embedded);
    // The owner signs the enable typed data here. No private key argument is passed, so none is serialized.
    const approval = await serializePermissionAccount(owner.account);
    const reply = await post<ApprovalRequest>("/api/approval", { owner: owner.address, account: owner.account.address, approval });
    setTable(reply.table);
    note(reply.ok ? "server used the session key, see table" : `server error: ${reply.error}`);
  });

  const revoke = run(async () => {
    if (!owner || !embedded) return;
    await ownerWallet(embedded);
    const sudoAccount = await createKernelAccount(publicClient, { entryPoint, kernelVersion, plugins: { sudo: owner.sudo } });
    if (!isAddressEqual(sudoAccount.address, owner.account.address)) throw new Error("sudo account address differs from the agent account");
    const sudoClient = createKernelAccountClient({ account: sudoAccount, chain, bundlerTransport: http(bundlerUrl), client: publicClient });
    const userOpHash = await sudoClient.uninstallPlugin({ plugin: owner.permission });
    note(`revoke UserOp sent ${userOpHash}`);
    const reply = await post<RevokedRequest>("/api/revoked", { userOpHash });
    setTable(reply.table);
    note(reply.ok ? "server retried with the revoked key, see table" : `server error: ${reply.error}`);
  });

  if (!ready) return <p>loading Privy</p>;
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "24px auto", padding: "0 16px" }}>
      <h1>Issue #19 spike: Privy owner, server-side session key, Monad testnet</h1>
      {!authenticated ? (
        <button onClick={login}>1. Log in with Privy</button>
      ) : (
        <>
          <p>embedded wallet: {embedded?.address ?? "not provisioned yet"}</p>
          <button disabled={busy || !embedded} onClick={createAccount}>2. Derive account with session key address</button>{" "}
          <button disabled={busy || !owner} onClick={fund}>3. Fund account with {formatEther(fundAmount)} MON</button>{" "}
          <button disabled={busy || !owner} onClick={approve}>4. Sign approval, hand to server</button>{" "}
          <button disabled={busy || !owner} onClick={revoke}>5. Revoke session key</button>{" "}
          <button disabled={busy} onClick={logout}>log out</button>
        </>
      )}
      <pre style={{ whiteSpace: "pre-wrap" }}>{log.join("\n")}</pre>
      {table && <textarea readOnly value={table} style={{ width: "100%", height: 320 }} />}
    </main>
  );
}
