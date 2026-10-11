import type { X402WalletConfig } from "@monadeum/wallets";
import { ValidatorPayer, X402PayerError, type Payer, type X402KeySource, type X402SlotStore } from "@monadeum/x402";
import type { Address } from "viem";
import { WorkerConfigError } from "./config.js";

/**
 * The worker's x402 payer switch (ARCHITECTURE.md section 16.3, open question 1). Off by default: an agent pays x402
 * only once WORKER_X402_PAYER_ENABLED is exactly "true", which the deployment sets after a facilitator on Monad has
 * been confirmed to accept ERC-1271 signatures for EIP-3009. Until then the payer refuses every payment, so every
 * purchase fails closed as `authorize-failed` and nothing is signed.
 */
export interface WorkerX402PayerConfig {
  enabled: boolean;
  /** EIP-155 chain id of the settlement asset; the x402 network is `eip155:<chainId>`. */
  chainId: number;
  /** The settlement asset's EIP-712 domain. USDC on Monad: "USDC", "2" (read on mainnet 2026-10-10). */
  assetName: string;
  assetVersion: string;
}

type Env = Record<string, string | undefined>;

export function loadX402PayerConfig(env: Env): WorkerX402PayerConfig {
  const flag = env.WORKER_X402_PAYER_ENABLED?.trim() ?? "";
  if (flag !== "" && flag !== "true" && flag !== "false") throw new WorkerConfigError("WORKER_X402_PAYER_ENABLED must be true or false");
  const enabled = flag === "true";
  const rawChain = env.WORKER_X402_CHAIN_ID?.trim() ?? "";
  if (enabled && !/^\d+$/.test(rawChain)) throw new WorkerConfigError("WORKER_X402_CHAIN_ID must be set to an integer when the x402 payer is enabled");
  return {
    enabled,
    chainId: rawChain ? Number(rawChain) : 0,
    assetName: env.WORKER_X402_ASSET_NAME?.trim() || "USDC",
    assetVersion: env.WORKER_X402_ASSET_VERSION?.trim() || "2",
  };
}

/** The payer used while the switch is off: it signs nothing. */
export class DisabledX402Payer implements Payer {
  async authorize(_request: Parameters<Payer["authorize"]>[0]): Promise<never> {
    throw new X402PayerError("the x402 payer is disabled until a facilitator on Monad is confirmed to accept ERC-1271 signatures");
  }
}

/** The agent of a tick key, `${agentId}:${tick}` as `tickKey` in @monadeum/tick builds it. */
export function agentOfTickKey(tickKey: string): string {
  const at = tickKey.lastIndexOf(":");
  if (at <= 0 || !/^\d+$/.test(tickKey.slice(at + 1))) throw new X402PayerError(`not a tick key: ${tickKey}`);
  return tickKey.slice(0, at);
}

/**
 * The Payer for the worker's X402Client. Disabled unless both the switch is on and WalletsModule has x402 settings
 * (WALLETS_X402_VALIDATOR_ADDRESS); then a ValidatorPayer over WalletsService's x402 keys and the durable slot store.
 */
export function buildX402Payer(input: {
  config: WorkerX402PayerConfig;
  wallets: X402KeySource;
  /** WalletsModule's x402 settings, the same values the validator was installed with; null when not configured. */
  validator: X402WalletConfig | null;
  slots: X402SlotStore;
  log?: (message: string) => void;
}): Payer {
  const { config, validator } = input;
  if (!config.enabled) {
    input.log?.("x402 payer disabled: no x402 payment is signed (WORKER_X402_PAYER_ENABLED is not true)");
    return new DisabledX402Payer();
  }
  if (!validator) throw new WorkerConfigError("the x402 payer is enabled but WalletsModule has no x402 validator configured");
  return new ValidatorPayer(input.wallets, input.slots, {
    asset: { address: validator.settlementAsset as Address, chainId: config.chainId, name: config.assetName, version: config.assetVersion },
    maxValue: validator.maxValue,
    paymentsPerEpoch: validator.paymentsPerEpoch,
    maxValidity: validator.maxValidity,
    payees: validator.payees,
    agentOf: agentOfTickKey,
  });
}
