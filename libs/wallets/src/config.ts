import { isAddress, isHex, type Address, type Hex } from "viem";
import { monadTestnet } from "viem/chains";
import type { SponsorshipBudget } from "./budget.js";
import { buildScope } from "./scope.js";
import type { ZeroDevChainConfig } from "./zerodev.js";

// Environment variables, documented in libs/wallets/README.md. None of them is a private key: the module generates
// session keys itself and keeps them in the SessionKeyVault, and owner keys never reach the platform.

export class WalletsConfigError extends Error {}

export interface WalletsConfig {
  chain: ZeroDevChainConfig;
  budget: SponsorshipBudget;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new WalletsConfigError(`${name} is not set`);
  return value;
}

function address(env: Env, name: string): Address {
  const value = required(env, name);
  if (!isAddress(value)) throw new WalletsConfigError(`${name} is not an address`);
  return value;
}

function hex(env: Env, name: string): Hex {
  const value = env[name]?.trim() || "0x";
  if (!isHex(value)) throw new WalletsConfigError(`${name} is not hex`);
  return value;
}

function selectors(env: Env, name: string): Hex[] {
  return required(env, name).split(",").map((s) => s.trim()).filter(Boolean) as Hex[];
}

function nonNegativeInteger(env: Env, name: string): bigint {
  const value = required(env, name);
  if (!/^\d+$/.test(value)) throw new WalletsConfigError(`${name} is not a non-negative integer`);
  return BigInt(value);
}

/**
 * Reads and validates the configuration. Monad testnet only: mainnet waits on the audit gate in SECURITY.md section 3,
 * and the call policy and spend policy addresses have not been checked on mainnet.
 */
export function loadWalletsConfig(env: Env = process.env): WalletsConfig {
  const chainId = Number(required(env, "WALLETS_CHAIN_ID"));
  if (chainId !== monadTestnet.id) throw new WalletsConfigError(`WALLETS_CHAIN_ID ${chainId} is not supported; only Monad testnet (${monadTestnet.id})`);
  const bundlerUrl = required(env, "WALLETS_BUNDLER_URL");
  const paymasterUrl = env.WALLETS_PAYMASTER_URL?.trim() || null;
  for (const [name, url] of [["WALLETS_BUNDLER_URL", bundlerUrl], ["WALLETS_PAYMASTER_URL", paymasterUrl]] as const) {
    if (url && !url.startsWith("https://")) throw new WalletsConfigError(`${name} must be an https URL`);
  }
  const scope = buildScope({
    settlementAsset: address(env, "WALLETS_SETTLEMENT_ASSET"),
    kuruRouter: address(env, "WALLETS_KURU_ROUTER"),
    kuruRouterSelectors: selectors(env, "WALLETS_KURU_ROUTER_SELECTORS"),
    reproduction: address(env, "WALLETS_REPRODUCTION_CONTRACT"),
    reproductionSelectors: selectors(env, "WALLETS_REPRODUCTION_SELECTORS"),
  });
  const operations = nonNegativeInteger(env, "WALLETS_SPONSORED_OPERATIONS");
  if (operations > BigInt(Number.MAX_SAFE_INTEGER)) throw new WalletsConfigError("WALLETS_SPONSORED_OPERATIONS is too large");
  return {
    chain: {
      chain: monadTestnet,
      rpcUrl: env.WALLETS_RPC_URL?.trim() || monadTestnet.rpcUrls.default.http[0],
      bundlerUrl,
      paymasterUrl,
      spendPolicy: {
        address: address(env, "WALLETS_SPEND_POLICY_ADDRESS"),
        policyData: hex(env, "WALLETS_SPEND_POLICY_DATA"),
        hookData: hex(env, "WALLETS_SPEND_POLICY_HOOK_DATA"),
      },
      scope,
    },
    budget: { operations: Number(operations), gasWei: nonNegativeInteger(env, "WALLETS_SPONSORED_GAS_WEI") },
  };
}
