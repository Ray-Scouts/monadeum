// Shared by the browser page and the Bun server. Holds no secret: everything here is public configuration.
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { CallPolicyVersion, toCallPolicy } from "@zerodev/permissions/policies";
import { parseEther, type Address } from "viem";
import { monadTestnet } from "viem/chains";

export const chain = monadTestnet;
export const CHAIN_ID = 10143;
export const entryPoint = getEntryPoint("0.7");
export const kernelVersion = KERNEL_V3_1;

/** The only thing the session key may do: a native transfer to the owner of at most this amount per call. */
export const CAP_PER_CALL = parseEther("0.001");
/** What the server sends in the in-policy step, half the cap. */
export const TEST_TRANSFER = CAP_PER_CALL / 2n;

/** The server listens here, on loopback only. The page reaches it through the Vite proxy under /api. */
export const SERVER_HOST = "127.0.0.1";
export const SERVER_PORT = 8788;
/** The only browser origin the server accepts, and the origin to allow in the Privy dashboard. */
export const WEB_ORIGIN = "http://localhost:5173";

/** Rejects any bundler URL that is not a ZeroDev v3 URL for chain 10143. */
export function assertTestnetBundler(url: string | undefined): string {
  if (!url) throw new Error("VITE_ZERODEV_RPC is not set, see .env.example");
  if (!/^https:\/\/rpc\.zerodev\.app\/api\/v3\/[^/]+\/chain\/10143(\?.*)?$/.test(url)) {
    throw new Error("VITE_ZERODEV_RPC must be a ZeroDev v3 URL for Monad testnet, chain 10143");
  }
  return url;
}

/** Call policy v0.0.4, same version the rolling daily cap spike exercised. Built identically on both sides. */
export function sessionPolicies(owner: Address) {
  return [
    toCallPolicy({
      policyVersion: CallPolicyVersion.V0_0_4,
      permissions: [{ target: owner, valueLimit: CAP_PER_CALL }],
    }),
  ];
}

/** Body of POST /api/approval. The approval is public data: it carries no private key, see README. */
export type ApprovalRequest = { owner: Address; account: Address; approval: string };
/** Body of POST /api/revoked: the owner's uninstall UserOp hash, so the server can record it from its receipt. */
export type RevokedRequest = { userOpHash: `0x${string}` };
export type ServerReply = { ok: boolean; table: string; error?: string };
