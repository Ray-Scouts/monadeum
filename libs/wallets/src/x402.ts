import {
  concat,
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  isAddress,
  isAddressEqual,
  keccak256,
  parseAbiParameters,
  size,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

// Off-chain counterpart of contracts/src/X402PaymentValidator.sol (ARCHITECTURE.md section 16.3, x402 signature
// path). It builds what the validator accepts and nothing else: an EIP-3009 TransferWithAuthorization from the agent
// account to a listed payee, within the configured value, validity, and per-hour slot bounds, signed by the x402 key
// over Kernel v3.1's account-domain wrapping of the settlement asset's digest. Every bound is checked here before
// signing so the key never signs what the account would refuse; the validator is the enforcement point, not this.

/** keccak256("monadeum.x402.nonce.v1"), the validator's NONCE_TAG. */
export const X402_NONCE_TAG = keccak256(toHex("monadeum.x402.nonce.v1"));
export const X402_EPOCH_SECONDS = 3600n;
/** The validator's EPOCHS_PER_24H_BOUND: hour boundaries a 24-hour period can touch with windows of at most an hour. */
export const X402_EPOCHS_PER_24H_BOUND = 26n;
export const X402_MAX_PAYEES = 8;
/** Seconds `validAfter` is set before `now`: USDC requires `now > validAfter`, the x402 facilitator `validAfter <= now`. */
export const X402_VALID_AFTER_SKEW = 5n;

/** Kernel v3.1's EIP-712 domain name and version (Kernel.sol `_domainNameAndVersion`), read on Monad mainnet 2026-10-10. */
const KERNEL_DOMAIN = { name: "Kernel", version: "0.3.1" } as const;

export class X402Error extends Error {}

export interface X402ValidatorConfig {
  /** The x402 key's address: a key separate from the trading session key. */
  signer: Address;
  /** Settlement-asset base units per authorization. */
  maxValue: bigint;
  /** Distinct nonces, so payments, per hour. */
  paymentsPerEpoch: number;
  /** Seconds, `validBefore - validAfter`, at most one hour. */
  maxValidity: number;
  /** The x402 providers' pay-to addresses, at most eight. */
  payees: readonly Address[];
}

/** The settlement asset's EIP-712 domain, as USDC (FiatToken v2.2) defines it. */
export interface SettlementAssetDomain {
  address: Address;
  chainId: number;
  /** "USDC" on Monad mainnet, read 2026-10-10. */
  name: string;
  /** "2" on Monad mainnet, read 2026-10-10. */
  version: string;
}

export interface X402Authorization {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

/** Signs a 32-byte hash with no prefix, as viem's LocalAccount `sign` does. */
export interface RawHashSigner {
  address: Address;
  sign(args: { hash: Hex }): Promise<Hex>;
}

/** Upper bound on what the configuration lets leave the account in any 24 hours, the validator's maxOutflowPer24h. */
export function x402MaxOutflowPer24h(config: Pick<X402ValidatorConfig, "maxValue" | "paymentsPerEpoch">): bigint {
  return X402_EPOCHS_PER_24H_BOUND * BigInt(config.paymentsPerEpoch) * config.maxValue;
}

/**
 * The validator's `onInstall` data, after the same checks the contract makes, plus the payee rules that depend on
 * the account and asset. Installation itself is an owner operation through the root validator.
 */
export function x402ValidatorInstallData(
  config: X402ValidatorConfig,
  context: { account: Address; settlementAsset: Address; validator: Address },
): Hex {
  if (!isAddress(config.signer) || isAddressEqual(config.signer, zeroAddress)) throw new X402Error("signer: not a nonzero address");
  if (config.maxValue <= 0n || config.maxValue >= 2n ** 128n) throw new X402Error("maxValue: out of range");
  if (!Number.isInteger(config.paymentsPerEpoch) || config.paymentsPerEpoch <= 0 || config.paymentsPerEpoch >= 2 ** 32) {
    throw new X402Error("paymentsPerEpoch: out of range");
  }
  if (!Number.isInteger(config.maxValidity) || config.maxValidity <= 0 || config.maxValidity > Number(X402_EPOCH_SECONDS)) {
    throw new X402Error("maxValidity: must be 1 to 3600 seconds");
  }
  if (config.payees.length === 0 || config.payees.length > X402_MAX_PAYEES) throw new X402Error("payees: 1 to 8 required");
  const forbidden = [zeroAddress, context.account, context.settlementAsset, context.validator].map((a) => a.toLowerCase());
  const seen = new Set<string>();
  for (const payee of config.payees) {
    if (!isAddress(payee)) throw new X402Error(`payee ${payee}: not an address`);
    const key = payee.toLowerCase();
    if (forbidden.includes(key) || seen.has(key)) throw new X402Error(`payee ${payee}: not allowed`);
    seen.add(key);
  }
  return encodeAbiParameters(parseAbiParameters("address, uint128, uint32, uint32, address[]"), [
    getAddress(config.signer),
    config.maxValue,
    config.paymentsPerEpoch,
    config.maxValidity,
    config.payees.map((p) => getAddress(p)),
  ]);
}

/** The validator's `nonceFor(account, epoch, slot)`. */
export function x402Nonce(account: Address, epoch: bigint, slot: bigint): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, address, uint256, uint256"), [X402_NONCE_TAG, getAddress(account), epoch, slot]),
  );
}

/**
 * Builds an authorization the validator accepts, or throws. `slot` must be unused for the hour of `validAfter`;
 * allocating it is the caller's job (a reused slot is refused by the token, never paid twice).
 */
export function buildX402Authorization(input: {
  account: Address;
  payTo: Address;
  value: bigint;
  nowSeconds: bigint;
  validitySeconds: bigint;
  slot: number;
  config: X402ValidatorConfig;
}): X402Authorization {
  const { config } = input;
  if (!config.payees.some((p) => isAddressEqual(p, input.payTo))) throw new X402Error("payTo: not a listed payee");
  if (input.value <= 0n || input.value > config.maxValue) throw new X402Error("value: outside (0, maxValue]");
  if (input.validitySeconds <= 0n || input.validitySeconds > BigInt(config.maxValidity)) throw new X402Error("validity: outside (0, maxValidity]");
  if (!Number.isInteger(input.slot) || input.slot < 0 || input.slot >= config.paymentsPerEpoch) throw new X402Error("slot: out of range");
  if (input.nowSeconds <= X402_VALID_AFTER_SKEW) throw new X402Error("now: invalid");
  const validAfter = input.nowSeconds - X402_VALID_AFTER_SKEW;
  return {
    from: getAddress(input.account),
    to: getAddress(input.payTo),
    value: input.value,
    validAfter,
    validBefore: validAfter + input.validitySeconds,
    nonce: x402Nonce(input.account, validAfter / X402_EPOCH_SECONDS, BigInt(input.slot)),
  };
}

/** The settlement asset's EIP-712 digest of the authorization (EIP-3009 TransferWithAuthorization). */
export function x402AuthorizationDigest(asset: SettlementAssetDomain, auth: X402Authorization): Hex {
  return hashTypedData({
    domain: { name: asset.name, version: asset.version, chainId: asset.chainId, verifyingContract: getAddress(asset.address) },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: auth,
  });
}

/** Kernel v3.1's `_toWrappedHash(digest)` for the account: what the account passes the validator and the key signs. */
export function kernelWrappedHash(account: Address, chainId: number, digest: Hex): Hex {
  return hashTypedData({
    domain: { ...KERNEL_DOMAIN, chainId, verifyingContract: getAddress(account) },
    types: { Kernel: [{ name: "hash", type: "bytes32" }] },
    primaryType: "Kernel",
    message: { hash: digest },
  });
}

/**
 * Signs the authorization with the x402 key and returns the ERC-1271 signature to put in the x402 payload:
 * 0x01 (Kernel validator mode) | validator | abi.encode(to, value, validAfter, validBefore, slot) | r | s | v.
 */
export async function signX402Authorization(input: {
  key: RawHashSigner;
  validator: Address;
  asset: SettlementAssetDomain;
  authorization: X402Authorization;
  slot: number;
}): Promise<Hex> {
  const { authorization: auth } = input;
  const wrapped = kernelWrappedHash(auth.from, input.asset.chainId, x402AuthorizationDigest(input.asset, auth));
  const signature = await input.key.sign({ hash: wrapped });
  if (size(signature) !== 65) throw new X402Error("signer: expected a 65-byte signature");
  const fields = encodeAbiParameters(parseAbiParameters("address, uint256, uint256, uint256, uint256"), [
    auth.to,
    auth.value,
    auth.validAfter,
    auth.validBefore,
    BigInt(input.slot),
  ]);
  return concat(["0x01", getAddress(input.validator), fields, signature]);
}
