import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { isHex, type Hex, type TypedDataDefinition } from "viem";
import type { Eip1193 } from "./signing";

/**
 * Sign in and sign with a passkey, through Mera (`@category-labs/mera`, preview). A passkey's WebAuthn PRF output is 32
 * secret bytes that the authenticator recomputes on demand; this module derives one ordinary Ethereum account from
 * them and exposes it as an EIP-1193 provider, so the rest of the app treats it as any external wallet: the API sees a
 * wallet address and an EIP-4361 signature, and nothing else. No key is stored. The key exists only inside one signing
 * call and is zeroed when the call ends, and every signature is a fresh passkey prompt.
 *
 * The derivation path is the one Mera's documentation uses (BIP-39 from the PRF bytes, BIP-44 `m/44'/60'/0'/0/0`).
 * Changing it would change every account, so it is fixed here and covered by a test.
 */

export const MERA_DERIVATION_PATH = "m/44'/60'/0'/0/0";
const CREDENTIAL_KEY = "monadeum.mera.credential";
const METHOD_KEY = "monadeum.signin.method";

export interface MeraCredential {
  credentialId: string;
  transports?: string[];
}

/** Yields the passkey's 32 PRF bytes after a user-verification prompt. Injected so tests need no authenticator. */
export type PrfSource = () => Promise<Uint8Array>;

/** The 32 PRF bytes to the account they derive, as the private key plus its address. Callers must zero `privateKey`. */
export async function deriveAccount(prfOutput: Uint8Array): Promise<{ privateKey: Uint8Array; address: Hex }> {
  if (prfOutput.length !== 32) throw new Error("A passkey PRF output must be 32 bytes.");
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  try {
    const key = HDKey.fromMasterSeed(seed).derive(MERA_DERIVATION_PATH).privateKey;
    if (!key) throw new Error("The passkey did not yield an account key.");
    const privateKey = new Uint8Array(key);
    const { privateKeyToAccount } = await import("viem/accounts");
    const address = privateKeyToAccount(toHex(privateKey)).address;
    return { privateKey, address };
  } finally {
    seed.fill(0);
  }
}

const toHex = (bytes: Uint8Array): Hex => `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;

interface MeraAccount {
  address: Hex;
  signMessage(args: { message: { raw: Hex } }): Promise<Hex>;
  signTypedData(typedData: TypedDataDefinition): Promise<Hex>;
}

/**
 * Runs `use` with a viem account over the derived key, then ends the Mera session (which zeros its copy of the key)
 * and zeros ours, whether `use` returned or threw.
 */
async function withAccount<T>(prfOutput: Uint8Array, use: (account: MeraAccount) => Promise<T>): Promise<T> {
  const { privateKey } = await deriveAccount(prfOutput);
  const { createSecp256k1SigningSession } = await import("@category-labs/mera");
  const { toViemAccount } = await import("@category-labs/mera/viem");
  const session = createSecp256k1SigningSession({ privateKey });
  try {
    return await use(toViemAccount(session) as never);
  } finally {
    session.end();
    privateKey.fill(0);
  }
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * An EIP-1193 provider over a passkey. It answers only what the app asks of a wallet: accounts, the two signing
 * methods, and a chain switch it does not need. `address` fixes which account may sign: when the passkey derives a
 * different one, the call fails before anything is signed, so a different passkey can never sign for the owner wallet.
 * `prf` is called once per signature, never cached.
 */
export function createMeraProvider(prf: PrfSource, address: string | null = null): Eip1193 {
  const sign = async <T>(expected: string, run: (account: MeraAccount) => Promise<T>): Promise<T> => {
    const output = await prf();
    try {
      return await withAccount(output, async (account) => {
        if (!sameAddress(account.address, expected)) {
          throw new Error(`This passkey is not the account ${expected}. Choose the passkey you signed in with.`);
        }
        return run(account);
      });
    } finally {
      output.fill(0);
    }
  };
  return {
    async request({ method, params = [] }) {
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts": {
          if (address) return [address];
          const output = await prf();
          try {
            const derived = await deriveAccount(output);
            derived.privateKey.fill(0);
            return [derived.address];
          } finally {
            output.fill(0);
          }
        }
        case "wallet_switchEthereumChain":
          // Signing is chain-agnostic here: typed data carries its own domain, so there is no active chain to switch.
          return null;
        case "personal_sign": {
          const [message, signer] = params as [unknown, unknown];
          if (typeof message !== "string" || !isHex(message) || typeof signer !== "string") throw new Error("personal_sign needs a hex message and an address.");
          return sign(signer, (account) => account.signMessage({ message: { raw: message } }));
        }
        case "eth_signTypedData_v4": {
          const [signer, payload] = params as [unknown, unknown];
          if (typeof signer !== "string" || typeof payload !== "string") throw new Error("eth_signTypedData_v4 needs an address and a JSON payload.");
          const typedData = JSON.parse(payload) as TypedDataDefinition & { types: Record<string, unknown> };
          // viem derives the domain type from the domain's own fields, which is what the API verifies against.
          const { EIP712Domain: _domain, ...types } = typedData.types;
          return sign(signer, (account) => account.signTypedData({ ...typedData, types } as TypedDataDefinition));
        }
        default:
          throw Object.assign(new Error(`The passkey account does not support ${method}.`), { code: 4200 });
      }
    },
  };
}

/** Whether the browser can run the WebAuthn ceremonies Mera needs. PRF support itself is known only after a prompt. */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined" && window.isSecureContext;
}

// Browser storage. Only the credential's public handle and the last sign-in method are kept, never key material, and
// every access is guarded because storage can be blocked.

export function readCredential(): MeraCredential | null {
  try {
    const raw = window.localStorage.getItem(CREDENTIAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MeraCredential>;
    return typeof parsed.credentialId === "string" ? { credentialId: parsed.credentialId, transports: parsed.transports } : null;
  } catch {
    return null;
  }
}

export function writeCredential(credential: MeraCredential): void {
  try {
    window.localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(credential));
  } catch {
    // The passkey still works: without the stored handle the browser offers the user's passkeys for this site.
  }
}

/** Which sign-in method opened the current API session, so owner operations ask the same wallet. */
export type SignInMethod = "passkey" | "wallet";

export function readMethod(): SignInMethod | null {
  try {
    const value = window.localStorage.getItem(METHOD_KEY);
    return value === "passkey" || value === "wallet" ? value : null;
  } catch {
    return null;
  }
}

export function writeMethod(method: SignInMethod | null): void {
  try {
    if (method) window.localStorage.setItem(METHOD_KEY, method);
    else window.localStorage.removeItem(METHOD_KEY);
  } catch {
    // Without it, owner operations fall back to the browser wallet and say so when none is found.
  }
}

/** Creates a passkey on this device and returns its first PRF output. One prompt, sometimes two (Mera documents why). */
export async function createPasskey(): Promise<Uint8Array> {
  const { createPasskeyWithPrfOutput } = await import("@category-labs/mera");
  const created = await createPasskeyWithPrfOutput({
    rp: { id: window.location.hostname, name: "Monadeum" },
    user: { name: "Monadeum owner", displayName: "Monadeum owner" },
  });
  writeCredential({ credentialId: created.credentialId, transports: created.transports as string[] | undefined });
  return created.prfOutput;
}

/** Asks for the user's passkey for this site, by the stored handle when there is one. */
export async function assertPasskey(): Promise<Uint8Array> {
  const { getPasskeyPrfOutput } = await import("@category-labs/mera");
  const stored = readCredential();
  const { prfOutput } = await getPasskeyPrfOutput({
    rpId: window.location.hostname,
    ...(stored ? { credential: stored as never } : {}),
  });
  return prfOutput;
}

/** The plain-language message for a failed passkey step. */
export function describeMeraError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "PRF_UNAVAILABLE") {
    return "This passkey does not support the PRF extension that derives your account. Use iCloud Keychain, 1Password, or Google Password Manager (desktop Chrome needs a passkey saved in Google Password Manager).";
  }
  if (code === "PASSKEY_OPERATION_FAILED") return "The passkey request was cancelled or is not available in this browser.";
  return error instanceof Error ? error.message : "Passkey sign-in failed. Try again, or use the other sign-in option.";
}
