import { isAddress, isHex, type Address, type Hex } from "viem";
import { monadTestnet } from "viem/chains";
import type { SponsorshipBudget } from "./budget.js";
import { buildScope } from "./scope.js";
import type { X402WalletSettings } from "./wallets.service.js";
import { X402_LIMITS } from "./x402.js";
import type { ZeroDevChainConfig } from "./zerodev.js";

// Environment variables, documented in libs/wallets/README.md. None of them is a private key: the module generates
// session keys itself and keeps them in the SessionKeyVault, and owner keys never reach the platform.

export class WalletsConfigError extends Error {}

/** The x402 settings of WalletsService, without the vault, which the process supplies. */
export type X402WalletConfig = Omit<X402WalletSettings, "vault">;

export interface WalletsConfig {
  chain: ZeroDevChainConfig;
  budget: SponsorshipBudget;
  /** Null unless WALLETS_X402_VALIDATOR_ADDRESS is set: no x402 key is created and agents cannot pay x402. */
  x402: X402WalletConfig | null;
}

function positiveInteger(env: Env, name: string, fallback: bigint): bigint {
  const value = env[name]?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || BigInt(value) === 0n) throw new WalletsConfigError(`${name} is not a positive integer`);
  return BigInt(value);
}

/**
 * The x402 validator settings. `maxValue`, `paymentsPerEpoch`, and `maxValidity` default to X402_LIMITS,
 * the values the owner decided. Every value is checked again when install data is built.
 */
function x402Config(env: Env, settlementAsset: Address): X402WalletConfig | null {
  if (!env.WALLETS_X402_VALIDATOR_ADDRESS?.trim()) return null;
  const payees = required(env, "WALLETS_X402_PAYEES").split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of payees) if (!isAddress(p)) throw new WalletsConfigError(`WALLETS_X402_PAYEES: ${p} is not an address`);
  const maxValue = positiveInteger(env, "WALLETS_X402_MAX_VALUE", X402_LIMITS.maxValue);
  const paymentsPerEpoch = positiveInteger(env, "WALLETS_X402_PAYMENTS_PER_EPOCH", BigInt(X402_LIMITS.paymentsPerEpoch));
  const maxValidity = positiveInteger(env, "WALLETS_X402_MAX_VALIDITY", BigInt(X402_LIMITS.maxValidity));
  if (maxValue >= 2n ** 128n) throw new WalletsConfigError("WALLETS_X402_MAX_VALUE must fit uint128");
  if (paymentsPerEpoch >= 2n ** 32n) throw new WalletsConfigError("WALLETS_X402_PAYMENTS_PER_EPOCH must fit uint32");
  if (maxValidity > 3600n) throw new WalletsConfigError("WALLETS_X402_MAX_VALIDITY must be at most 3600 seconds");
  if (payees.length === 0 || payees.length > 8) throw new WalletsConfigError("WALLETS_X402_PAYEES must list 1 to 8 addresses");
  return {
    validator: address(env, "WALLETS_X402_VALIDATOR_ADDRESS"),
    settlementAsset,
    maxValue,
    paymentsPerEpoch: Number(paymentsPerEpoch),
    maxValidity: Number(maxValidity),
    payees: payees as Address[],
  };
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

function hookData(env: Env): Hex {
  const value = env.WALLETS_SPEND_POLICY_HOOK_DATA?.trim() || "0x00";
  if (!isHex(value) || value.length < 4) throw new WalletsConfigError("WALLETS_SPEND_POLICY_HOOK_DATA must be at least one byte of hex");
  return value;
}

function selectors(env: Env, name: string): Hex[] {
  return required(env, name).split(",").map((s) => s.trim()).filter(Boolean) as Hex[];
}

/** Optional: the ERC-20 bases a close sells, comma-separated. Unset means no close can be built for any agent. */
function tradedAssets(env: Env): Address[] {
  const list = (env.WALLETS_TRADED_ASSETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const a of list) if (!isAddress(a)) throw new WalletsConfigError(`WALLETS_TRADED_ASSETS: ${a} is not an address`);
  return list as Address[];
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
  const settlementAsset = address(env, "WALLETS_SETTLEMENT_ASSET");
  const scope = buildScope({
    settlementAsset,
    kuruRouter: address(env, "WALLETS_KURU_ROUTER"),
    kuruRouterSelectors: selectors(env, "WALLETS_KURU_ROUTER_SELECTORS"),
    reallocation: address(env, "WALLETS_REALLOCATION_CONTRACT"),
    reallocationSelectors: selectors(env, "WALLETS_REALLOCATION_SELECTORS"),
    tradedAssets: tradedAssets(env),
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
        hookData: hookData(env),
      },
      scope,
    },
    budget: { operations: Number(operations), gasWei: nonNegativeInteger(env, "WALLETS_SPONSORED_GAS_WEI") },
    x402: x402Config(env, settlementAsset),
  };
}
