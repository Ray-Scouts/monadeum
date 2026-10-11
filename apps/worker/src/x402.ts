import type { AgentStore } from "@monadeum/agent-registry";
import type { X402WalletConfig } from "@monadeum/wallets";
import {
  ValidatorPayer,
  X402PayerError,
  reconcileSettlements,
  settlementEventsAbi,
  settlementsFromLogs,
  type ChainLog,
  type Payer,
  type PaymentLog,
  type SettlementAlert,
  type X402KeySource,
  type X402SlotStore,
} from "@monadeum/x402";
import { getAddress, type Address, type Hex } from "viem";
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
  /** How often the `x402-reconcile` job runs. WORKER_X402_RECONCILE_INTERVAL_MS, default 300000 (a starting value). */
  reconcileIntervalMs: number;
}

type Env = Record<string, string | undefined>;

export function loadX402PayerConfig(env: Env): WorkerX402PayerConfig {
  const flag = env.WORKER_X402_PAYER_ENABLED?.trim() ?? "";
  if (flag !== "" && flag !== "true" && flag !== "false") throw new WorkerConfigError("WORKER_X402_PAYER_ENABLED must be true or false");
  const enabled = flag === "true";
  const rawChain = env.WORKER_X402_CHAIN_ID?.trim() ?? "";
  if (enabled && !/^\d+$/.test(rawChain)) throw new WorkerConfigError("WORKER_X402_CHAIN_ID must be set to an integer when the x402 payer is enabled");
  const rawInterval = env.WORKER_X402_RECONCILE_INTERVAL_MS?.trim() ?? "";
  if (rawInterval && (!/^\d+$/.test(rawInterval) || Number(rawInterval) < 1_000 || !Number.isSafeInteger(Number(rawInterval)))) {
    throw new WorkerConfigError("WORKER_X402_RECONCILE_INTERVAL_MS must be an integer of at least 1000");
  }
  return {
    enabled,
    chainId: rawChain ? Number(rawChain) : 0,
    assetName: env.WORKER_X402_ASSET_NAME?.trim() || "USDC",
    assetVersion: env.WORKER_X402_ASSET_VERSION?.trim() || "2",
    reconcileIntervalMs: rawInterval ? Number(rawInterval) : 300_000,
  };
}

/** Recent logs of the settlement asset that concern `accounts`: their AuthorizationUsed events and their Transfers out. */
export interface SettlementLogSource {
  logs(asset: Address, accounts: readonly Address[]): Promise<ChainLog[]>;
}

/** The two RPC reads `RpcSettlementLogSource` makes, as a viem public client provides them. */
export interface LogReader {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: {
    address: Address;
    event: (typeof settlementEventsAbi)[number];
    args: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<{ address: Address; topics: Hex[]; data: Hex; transactionHash: Hex | null; blockNumber: bigint | null; logIndex: number | null }[]>;
}

/**
 * Reads the last `lookbackBlocks` blocks of the settlement asset over RPC, on every run. Reconciliation is idempotent,
 * so overlapping windows only repeat alerts; the window must cover at least the job interval, or a settlement can fall
 * between two runs unchecked. Pending logs (no transaction hash or block yet) are left for the next run.
 */
export class RpcSettlementLogSource implements SettlementLogSource {
  constructor(private readonly client: LogReader, private readonly lookbackBlocks: bigint) {}

  async logs(asset: Address, accounts: readonly Address[]): Promise<ChainLog[]> {
    if (accounts.length === 0) return [];
    const toBlock = await this.client.getBlockNumber();
    const fromBlock = toBlock > this.lookbackBlocks ? toBlock - this.lookbackBlocks : 0n;
    const [used, transfer] = settlementEventsAbi;
    const raw = [
      ...(await this.client.getLogs({ address: asset, event: used, args: { authorizer: [...accounts] }, fromBlock, toBlock })),
      ...(await this.client.getLogs({ address: asset, event: transfer, args: { from: [...accounts] }, fromBlock, toBlock })),
    ];
    return raw.flatMap((l) =>
      l.transactionHash && l.blockNumber !== null && l.logIndex !== null
        ? [{ address: l.address, topics: l.topics, data: l.data, transactionHash: l.transactionHash, blockNumber: l.blockNumber, logIndex: l.logIndex }]
        : [],
    );
  }
}

export interface ReconcileReport {
  /** Why nothing was checked, or null when the check ran. */
  skipped: string | null;
  checked: number;
  alerts: SettlementAlert[];
}

/**
 * The `x402-reconcile` job's work (SECURITY.md section 12): every x402 settlement from an active agent's account in
 * the recent logs must match a nonce slot the payer claimed and the payment log entry for it. Skipped, checking
 * nothing, while the payer is disabled (no slot can exist, and none is expected) or when no log source is configured.
 */
export class X402Reconciler {
  constructor(
    private readonly deps: {
      payerEnabled: boolean;
      source: SettlementLogSource | null;
      asset: Address | null;
      agents: Pick<AgentStore, "list">;
      slots: X402SlotStore;
      payments: PaymentLog;
    },
  ) {}

  async run(): Promise<ReconcileReport> {
    const { payerEnabled, source, asset } = this.deps;
    if (!payerEnabled) return { skipped: "the x402 payer is disabled", checked: 0, alerts: [] };
    if (!source || !asset) return { skipped: "no settlement log source is configured", checked: 0, alerts: [] };
    const accounts = (await this.deps.agents.list()).filter((a) => a.status === "active").map((a) => getAddress(a.account));
    const settlements = settlementsFromLogs(await source.logs(asset, accounts), asset, accounts);
    const alerts = await reconcileSettlements(settlements, { slots: this.deps.slots, log: this.deps.payments });
    return { skipped: null, checked: settlements.length, alerts };
  }
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
