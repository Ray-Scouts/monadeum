import { isAddress, type Address } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { monadTestnet } from "viem/chains";
import type { SyncOptions } from "./indexer.js";

export class IndexerConfigError extends Error {}

export interface IndexerConfig {
  chainId: number;
  rpcUrl: string | undefined;
  spendPolicy: Address;
  entryPoint: Address;
  pollIntervalMs: number;
  sync: SyncOptions;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new IndexerConfigError(`${name} is not set`);
  return value;
}

function integer(env: Env, name: string, fallback: bigint | null, min: bigint): bigint {
  const raw = env[name]?.trim();
  if (!raw) {
    if (fallback === null) throw new IndexerConfigError(`${name} is not set`);
    return fallback;
  }
  if (!/^\d+$/.test(raw)) throw new IndexerConfigError(`${name} is not a non-negative integer`);
  const value = BigInt(raw);
  if (value < min) throw new IndexerConfigError(`${name} must be at least ${min}`);
  return value;
}

function address(value: string, name: string): Address {
  if (!isAddress(value)) throw new IndexerConfigError(`${name} is not an address`);
  return value.toLowerCase() as Address;
}

/**
 * Reads and validates the configuration (documented in apps/indexer/README.md). Monad testnet only, like WalletsModule:
 * mainnet waits on the audit gate in SECURITY.md section 3.
 */
export function loadIndexerConfig(env: Env = process.env): IndexerConfig {
  const chainId = Number(required(env, "INDEXER_CHAIN_ID"));
  if (chainId !== monadTestnet.id) throw new IndexerConfigError(`INDEXER_CHAIN_ID ${chainId} is not supported; only Monad testnet (${monadTestnet.id})`);
  const rpcUrl = env.INDEXER_RPC_URL?.trim() || undefined;
  if (rpcUrl && !/^https?:\/\//.test(rpcUrl)) throw new IndexerConfigError("INDEXER_RPC_URL must be an http(s) URL");
  const confirmations = integer(env, "INDEXER_CONFIRMATIONS", 10n, 0n);
  const reorgWindow = integer(env, "INDEXER_REORG_WINDOW", 1000n, 1n);
  if (reorgWindow <= confirmations) throw new IndexerConfigError("INDEXER_REORG_WINDOW must be larger than INDEXER_CONFIRMATIONS");
  return {
    chainId,
    rpcUrl,
    spendPolicy: address(required(env, "INDEXER_SPEND_POLICY_ADDRESS"), "INDEXER_SPEND_POLICY_ADDRESS"),
    entryPoint: address(env.INDEXER_ENTRY_POINT_ADDRESS?.trim() || entryPoint07Address, "INDEXER_ENTRY_POINT_ADDRESS"),
    pollIntervalMs: Number(integer(env, "INDEXER_POLL_INTERVAL_MS", 1000n, 100n)),
    sync: {
      startBlock: integer(env, "INDEXER_START_BLOCK", null, 0n),
      batchSize: integer(env, "INDEXER_BATCH_SIZE", 100n, 1n),
      confirmations,
      reorgWindow,
    },
  };
}
