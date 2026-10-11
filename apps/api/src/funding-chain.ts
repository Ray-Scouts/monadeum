import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  domainSeparator,
  http,
  isAddressEqual,
  keccak256,
  parseAbi,
  parseSignature,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type PublicClient,
  TransactionReceiptNotFoundError,
} from "viem";
import type { FundingAuthorization } from "./funding-store.js";

// The chain side of the relayed funding transfer: reads of the settlement asset (USDC, FiatToken v2.2) and the relayer
// transaction that submits an owner's EIP-3009 authorization. `ViemFundingChain` implements it against an RPC; the
// tests implement it in memory.

/** The settlement asset's EIP-712 domain, as read from the contract and checked against its DOMAIN_SEPARATOR. */
export interface AssetDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
  decimals: number;
}

export interface RelayReceipt {
  status: "success" | "reverted";
  blockNumber: bigint;
}

/** A relayer transaction, signed and hashed, not yet sent. */
export interface PreparedRelay {
  hash: Hex;
  /** Gas limit times the maximum fee per gas: the most the relayer can be charged. Monad charges the gas limit. */
  maxCost: bigint;
  send(): Promise<void>;
}

export interface FundingChain {
  readonly chainId: number;
  readonly asset: Address;
  /** The relayer's address. Its key never leaves the chain adapter. */
  readonly relayer: Address;
  /** Reads name, version, and decimals, and throws unless DOMAIN_SEPARATOR equals the separator they define. */
  assetDomain(): Promise<AssetDomain>;
  balanceOf(owner: Address): Promise<bigint>;
  /** The token's `authorizationState(authorizer, nonce)`: true once the nonce is used or canceled. */
  authorizationUsed(authorizer: Address, nonce: Hex): Promise<boolean>;
  hasCode(account: Address): Promise<boolean>;
  nativeBalance(address: Address): Promise<bigint>;
  /**
   * Estimates, builds, and signs the relayer's `transferWithAuthorization` transaction. The estimate simulates the
   * call, so an authorization the token would refuse throws here, before anything is claimed or sent.
   */
  prepareRelay(authorization: FundingAuthorization, signature: Hex): Promise<PreparedRelay>;
  /** Null while the transaction is not in a block. */
  receipt(hash: Hex): Promise<RelayReceipt | null>;
}

export const usdcAbi = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function decimals() view returns (uint8)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function balanceOf(address account) view returns (uint256)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);

/** The ECDSA parts of a 65-byte signature, as `transferWithAuthorization(..., v, r, s)` takes them. */
export function signatureParts(signature: Hex): { v: number; r: Hex; s: Hex } {
  const parsed = parseSignature(signature);
  const v = parsed.v !== undefined ? Number(parsed.v) : 27 + (parsed.yParity ?? 0);
  return { v: v < 27 ? v + 27 : v, r: parsed.r, s: parsed.s };
}

export function transferWithAuthorizationData(a: FundingAuthorization, signature: Hex): Hex {
  const { v, r, s } = signatureParts(signature);
  return encodeFunctionData({ abi: usdcAbi, functionName: "transferWithAuthorization", args: [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, v, r, s] });
}

export class ViemFundingChain implements FundingChain {
  readonly chainId: number;
  readonly asset: Address;
  readonly relayer: Address;
  private readonly client: PublicClient;
  private domain: AssetDomain | null = null;

  constructor(
    private readonly chain: Chain,
    rpcUrl: string,
    asset: Address,
    private readonly account: LocalAccount,
  ) {
    this.chainId = chain.id;
    this.asset = getAddress(asset);
    this.relayer = account.address;
    this.client = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 1, timeout: 15_000 }) }) as PublicClient;
  }

  async assetDomain(): Promise<AssetDomain> {
    if (this.domain) return this.domain;
    const read = <T>(functionName: "name" | "version" | "decimals" | "DOMAIN_SEPARATOR") => this.client.readContract({ address: this.asset, abi: usdcAbi, functionName }) as Promise<T>;
    const [name, version, decimals, separator, chainId] = await Promise.all([read<string>("name"), read<string>("version"), read<number>("decimals"), read<Hex>("DOMAIN_SEPARATOR"), this.client.getChainId()]);
    if (chainId !== this.chainId) throw new Error(`the RPC serves chain ${chainId}, not ${this.chainId}`);
    const domain: AssetDomain = { name, version, chainId, verifyingContract: this.asset, decimals: Number(decimals) };
    const expected = domainSeparator({ domain: { name, version, chainId, verifyingContract: this.asset } });
    if (expected.toLowerCase() !== separator.toLowerCase()) throw new Error("the settlement asset's DOMAIN_SEPARATOR does not match its name, version, chain, and address");
    this.domain = domain;
    return domain;
  }

  balanceOf(owner: Address) {
    return this.client.readContract({ address: this.asset, abi: usdcAbi, functionName: "balanceOf", args: [owner] });
  }

  authorizationUsed(authorizer: Address, nonce: Hex) {
    return this.client.readContract({ address: this.asset, abi: usdcAbi, functionName: "authorizationState", args: [authorizer, nonce] });
  }

  async hasCode(account: Address) {
    const code = await this.client.getCode({ address: account });
    return code !== undefined && code !== "0x";
  }

  nativeBalance(address: Address) {
    return this.client.getBalance({ address });
  }

  async prepareRelay(authorization: FundingAuthorization, signature: Hex): Promise<PreparedRelay> {
    const data = transferWithAuthorizationData(authorization, signature);
    const gas = await this.client.estimateGas({ account: this.relayer, to: this.asset, data });
    const fees = await this.client.estimateFeesPerGas();
    const nonce = await this.client.getTransactionCount({ address: this.relayer, blockTag: "pending" });
    const request = {
      chainId: this.chainId,
      type: "eip1559" as const,
      to: this.asset,
      data,
      value: 0n,
      gas,
      nonce,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
    const signed = await this.account.signTransaction!(request);
    const hash = keccak256(signed);
    return {
      hash,
      maxCost: gas * fees.maxFeePerGas,
      send: async () => {
        const sent = await this.client.sendRawTransaction({ serializedTransaction: signed });
        if (sent.toLowerCase() !== hash.toLowerCase()) throw new Error("the RPC returned another transaction hash");
      },
    };
  }

  async receipt(hash: Hex): Promise<RelayReceipt | null> {
    try {
      const r = await this.client.getTransactionReceipt({ hash });
      if (!isAddressEqual(r.to ?? "0x0000000000000000000000000000000000000000", this.asset)) throw new Error("the receipt is not a call to the settlement asset");
      return { status: r.status, blockNumber: r.blockNumber };
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }
  }
}
