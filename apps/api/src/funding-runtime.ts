import path from "node:path";
import { FileSessionKeyVault, vaultPassphrase, type ScryptParams } from "@monadeum/wallets";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { ApiConfigError } from "./config.js";
import { ViemFundingChain, type FundingChain } from "./funding-chain.js";

// The relayed funding transfer's process configuration and relayer key (ARCHITECTURE.md section 7, SECURITY.md
// section 11). Enabled by `API_FUNDING_RELAYER_VAULT_DIR`; Monad testnet only, and refused with MONADEUM_ENV=production
// like the session and x402 vaults, because the relayer key sits in the local encrypted file vault.

type Env = Record<string, string | undefined>;

/** The name the relayer key is held under in its vault. */
export const RELAYER_KEY_ID = "funding-relayer";

/** Proposed defaults, not derived from any measurement. */
export const DEFAULT_FUNDING_DAILY_TRANSFERS = 3;
export const DEFAULT_FUNDING_VALIDITY_SECONDS = 600;
/** Prepared, unexpired authorizations one user may hold at once, so prepare cannot be used to fill the table. */
export const FUNDING_OPEN_LIMIT = 5;

export interface FundingSettings {
  /** Largest value of one relayed transfer, settlement-asset base units. */
  maxPerTransfer: bigint;
  /** Relayed transfers per user per rolling 24 hours, whatever their outcome. */
  dailyTransfersPerUser: number;
  /** `validBefore - validAfter` of a prepared authorization, seconds. */
  validitySeconds: number;
}

export interface FundingConfig {
  vaultDirectory: string;
  settlementAsset: Address;
  rpcUrl: string;
  settings: FundingSettings;
}

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new ApiConfigError(`${name} must be an integer from ${min} to ${max}`);
  return Number(raw);
}

const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/** Null when `API_FUNDING_RELAYER_VAULT_DIR` is unset: the funding endpoints then answer 503. */
export function loadFundingConfig(env: Env): FundingConfig | null {
  const vaultDirectory = env.API_FUNDING_RELAYER_VAULT_DIR?.trim();
  if (!vaultDirectory) return null;
  if ((env.MONADEUM_ENV?.trim() || "development") === "production") {
    throw new ApiConfigError("MONADEUM_ENV is production: the funding relayer key is held in the local file vault, which is for testnet and local development only");
  }
  for (const other of ["WALLETS_SESSION_VAULT_DIR", "WALLETS_X402_VAULT_DIR"]) {
    const dir = env[other]?.trim();
    if (dir && (inside(path.resolve(dir), path.resolve(vaultDirectory)) || inside(path.resolve(vaultDirectory), path.resolve(dir)))) {
      throw new ApiConfigError(`API_FUNDING_RELAYER_VAULT_DIR must be a separate directory from ${other}, neither inside the other`);
    }
  }
  const asset = env.API_FUNDING_SETTLEMENT_ASSET?.trim();
  if (!asset || !isAddress(asset, { strict: false })) throw new ApiConfigError("API_FUNDING_SETTLEMENT_ASSET must be the settlement asset's address");
  const rpcUrl = env.API_FUNDING_RPC_URL?.trim() || env.WALLETS_RPC_URL?.trim() || monadTestnet.rpcUrls.default.http[0];
  if (!rpcUrl.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(rpcUrl)) throw new ApiConfigError("API_FUNDING_RPC_URL must be an https URL");
  const rawMax = env.API_FUNDING_MAX_PER_TRANSFER?.trim();
  if (!rawMax || !/^[1-9]\d{0,37}$/.test(rawMax)) throw new ApiConfigError("API_FUNDING_MAX_PER_TRANSFER must be a positive integer in base units");
  return {
    vaultDirectory,
    settlementAsset: getAddress(asset),
    rpcUrl,
    settings: {
      maxPerTransfer: BigInt(rawMax),
      dailyTransfersPerUser: integer(env, "API_FUNDING_DAILY_TRANSFERS_PER_USER", DEFAULT_FUNDING_DAILY_TRANSFERS, 1, 1000),
      validitySeconds: integer(env, "API_FUNDING_VALIDITY_SECONDS", DEFAULT_FUNDING_VALIDITY_SECONDS, 60, 3600),
    },
  };
}

export interface FundingRuntime {
  config: FundingConfig;
  chain: FundingChain;
  relayer: Address;
  close(): void;
}

export interface FundingRuntimeOptions {
  /** Replaces the RPC chain adapter, for tests; it receives the relayer's address. */
  chain?: (relayer: Address) => FundingChain;
  scrypt?: ScryptParams;
}

/**
 * Opens the relayer's vault and reads its key, creating the key on first boot when the vault holds none. Two processes
 * starting together cannot create two keys: the vault's write is create-only, so the loser reads the winner's key.
 * The key stays in this process's memory inside a viem account; only its address is returned or logged.
 */
export async function loadFundingRuntime(env: Env, options: FundingRuntimeOptions = {}): Promise<FundingRuntime | null> {
  const config = loadFundingConfig(env);
  if (!config) return null;
  const vault = await FileSessionKeyVault.open({ directory: config.vaultDirectory, passphrase: await vaultPassphrase(env, "API_FUNDING_RELAYER_VAULT"), purpose: "relayer", scrypt: options.scrypt });
  try {
    let key: Hex | null = await vault.get(RELAYER_KEY_ID);
    if (!key) {
      try {
        await vault.put(RELAYER_KEY_ID, generatePrivateKey());
      } catch {
        // Another process created it first; read theirs below.
      }
      key = await vault.get(RELAYER_KEY_ID);
      if (!key) throw new ApiConfigError("the funding relayer key could not be created");
    }
    const account = privateKeyToAccount(key);
    const chain = options.chain ? options.chain(account.address) : new ViemFundingChain(monadTestnet, config.rpcUrl, config.settlementAsset, account);
    return { config, chain, relayer: account.address, close: () => vault.close() };
  } catch (error) {
    vault.close();
    throw error;
  }
}
