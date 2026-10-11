import type { SponsorshipLedger } from "./budget.js";
import type { WalletsChain } from "./chain.js";
import { WalletsConfigError, loadWalletsConfig, type WalletsConfig } from "./config.js";
import { loadFileVaults, type FileVaults, type ScryptParams } from "./file-vault.js";
import type { AgentWalletStore } from "./store.js";
import { WalletsService } from "./wallets.service.js";
import { ZeroDevChain } from "./zerodev.js";

type Env = Record<string, string | undefined>;

/** WalletsModule's configuration and key vaults, read from a process environment, ready to build a service over stores. */
export interface WalletsRuntime {
  config: WalletsConfig;
  vaults: FileVaults;
  /** Builds the service over the process's own wallet store and sponsorship ledger. */
  build(store: AgentWalletStore, ledger: SponsorshipLedger): WalletsService;
  /** Overwrites the vaults' derived keys in memory. */
  close(): void;
}

export interface WalletsRuntimeOptions {
  /** Overrides the ZeroDev chain adapter, for tests. */
  chain?: WalletsChain;
  /** Overrides the vaults' scrypt parameters when a vault is created, for tests. */
  scrypt?: ScryptParams;
}

/**
 * Reads WalletsModule from the environment for a process (the API and the worker). Returns null, and builds nothing,
 * when `WALLETS_CHAIN_ID` is unset: the process then has no wallet operations. Once it is set, everything is required:
 * the `WALLETS_*` chain settings (`loadWalletsConfig`), the session key vault, and, when x402 is configured
 * (`WALLETS_X402_VALIDATOR_ADDRESS`), the separate x402 key vault. The only vault implemented is the local encrypted
 * file vault (`loadFileVaults`), which refuses `MONADEUM_ENV=production`, so a production process with
 * `WALLETS_CHAIN_ID` set refuses to start until a secrets-manager-backed vault exists.
 */
export async function loadWalletsRuntime(env: Env, options: WalletsRuntimeOptions = {}): Promise<WalletsRuntime | null> {
  if (!env.WALLETS_CHAIN_ID?.trim()) return null;
  const config = loadWalletsConfig(env);
  const vaults = await loadFileVaults(env, { scrypt: options.scrypt });
  if (!vaults) throw new WalletsConfigError("WALLETS_CHAIN_ID is set but no session key vault is configured: set WALLETS_SESSION_VAULT_DIR");
  if (config.x402 && !vaults.x402) {
    vaults.session.close();
    throw new WalletsConfigError("WALLETS_X402_VALIDATOR_ADDRESS is set but no x402 key vault is configured: set WALLETS_X402_VAULT_DIR");
  }
  const chain = options.chain ?? new ZeroDevChain(config.chain);
  return {
    config,
    vaults,
    build: (store, ledger) =>
      new WalletsService(chain, store, vaults.session, ledger, {
        scope: config.chain.scope,
        budget: config.budget,
        paymaster: config.chain.paymasterUrl !== null,
        x402: config.x402 && vaults.x402 ? { ...config.x402, vault: vaults.x402 } : null,
      }),
    close: () => {
      vaults.session.close();
      vaults.x402?.close();
    },
  };
}
