import { erc20Abi, parseAbi, type Abi, type Address, type Hex, type PublicClient } from "viem";
import type { ChainReader } from "./ports.js";

/**
 * The few JSON-RPC reads the tick runner makes, as a viem public client provides them (`rpcReads`). A narrow interface
 * so the readers can be tested with a stub and never send anything: there is no write method on it.
 */
export interface RpcReads {
  readContract(args: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }): Promise<unknown>;
  getBalance(args: { address: Address }): Promise<bigint>;
  getBlock(): Promise<{ number: bigint | null; timestamp: bigint }>;
  getChainId(): Promise<number>;
}

export function rpcReads(client: PublicClient): RpcReads {
  return {
    readContract: (args) => client.readContract(args as never) as Promise<unknown>,
    getBalance: (args) => client.getBalance(args),
    getBlock: () => client.getBlock({ blockTag: "latest" }),
    getChainId: () => client.getChainId(),
  };
}

/** The views of AgentSpendPolicy the worker reads (contracts/src/IAgentSpendPolicy.sol). */
export const SPEND_POLICY_READ_ABI = parseAbi([
  "function windowTotal(address account) view returns (uint256)",
  "function settlementAsset() view returns (address)",
]);

/** An agent account's holdings, base units of each asset; MON in wei. `traded` is null on a native-MON base market. */
export interface Holdings {
  settlement: bigint;
  traded: bigint | null;
  native: bigint;
}

/**
 * `ChainReader` over RPC (ARCHITECTURE.md section 11, "Tick runner"): the settlement asset's decimals and each
 * account's balance, which is the capital the RiskModule's ledger and the strategy read, and the spend policy's
 * `windowTotal(account)`, which is the ledger's `spentInWindow`, so the RiskModule and the chain count one rolling window
 * (section 16.1). A failed read throws; the tick then fails closed with no action. Reads only.
 */
export class RpcChainReader implements ChainReader {
  private cachedDecimals: number | null = null;

  constructor(
    private readonly rpc: RpcReads,
    private readonly addresses: { settlementAsset: Address; spendPolicy: Address; tradedAsset: Address | null },
  ) {}

  async decimals(): Promise<number> {
    if (this.cachedDecimals === null) {
      const value = Number(await this.rpc.readContract({ address: this.addresses.settlementAsset, abi: erc20Abi, functionName: "decimals" }));
      if (!Number.isInteger(value) || value < 0 || value > 36) throw new Error(`the settlement asset reports ${value} decimals`);
      this.cachedDecimals = value;
    }
    return this.cachedDecimals;
  }

  balanceOf(account: Hex): Promise<bigint> {
    return this.erc20Balance(this.addresses.settlementAsset, account);
  }

  async windowTotal(account: Hex): Promise<bigint> {
    return BigInt(await this.rpc.readContract({ address: this.addresses.spendPolicy, abi: SPEND_POLICY_READ_ABI, functionName: "windowTotal", args: [account] }) as bigint);
  }

  /** The settlement asset the spend policy counts; the runner refuses to start when it is not the configured one. */
  async policySettlementAsset(): Promise<Address> {
    return (await this.rpc.readContract({ address: this.addresses.spendPolicy, abi: SPEND_POLICY_READ_ABI, functionName: "settlementAsset" })) as Address;
  }

  /** Settlement asset, traded asset, and MON held by `account`, for monitoring and the read-only testnet check. */
  async holdings(account: Hex): Promise<Holdings> {
    const traded = this.addresses.tradedAsset;
    const [settlement, tradedBalance, native] = await Promise.all([
      this.balanceOf(account),
      traded ? this.erc20Balance(traded, account) : Promise.resolve(null),
      this.rpc.getBalance({ address: account }),
    ]);
    return { settlement, traded: tradedBalance, native };
  }

  private async erc20Balance(token: Address, account: Hex): Promise<bigint> {
    return BigInt(await this.rpc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] }) as bigint);
  }
}
