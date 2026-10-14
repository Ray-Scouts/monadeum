import { describe, expect, test } from "bun:test";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { verifyMessage, verifyTypedData, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { createMeraProvider, deriveAccount, MERA_DERIVATION_PATH } from "./mera";
import { messageHex, walletCall } from "./signing";

const PRF = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const OTHER_PRF = Uint8Array.from({ length: 32 }, (_, i) => 200 - i);
const freshPrf = (bytes: Uint8Array = PRF) => async () => Uint8Array.from(bytes);

// An independent derivation of the same account: viem's own BIP-39 and BIP-44 path, not this module's.
const expected = mnemonicToAccount(entropyToMnemonic(PRF, wordlist), { path: MERA_DERIVATION_PATH as `m/44'/60'/${string}` }).address;

describe("passkey account derivation", () => {
  test("derives the account Mera documents, and the same one every time", async () => {
    const a = await deriveAccount(PRF);
    const b = await deriveAccount(PRF);
    expect(a.address).toBe(expected);
    expect(b.address).toBe(a.address);
  });

  test("a different passkey derives a different account", async () => {
    expect((await deriveAccount(OTHER_PRF)).address).not.toBe(expected);
  });

  test("refuses a PRF output that is not 32 bytes", async () => {
    await expect(deriveAccount(new Uint8Array(16))).rejects.toThrow("32 bytes");
  });
});

describe("passkey provider", () => {
  test("reports the derived account", async () => {
    expect(await createMeraProvider(freshPrf()).request({ method: "eth_requestAccounts" })).toEqual([expected]);
  });

  test("personal_sign signs the exact bytes the API issued, verifiable as the account", async () => {
    const message = "Sign in to Monadeum.\nNonce: abc123";
    const signature = (await createMeraProvider(freshPrf(), expected).request({ method: "personal_sign", params: [messageHex(message), expected] })) as Hex;
    expect(await verifyMessage({ address: expected, message, signature })).toBe(true);
  });

  test("eth_signTypedData_v4 signs an owner operation the way the API verifies it", async () => {
    const typedData = {
      domain: { name: "Monadeum", version: "1", chainId: 10143, verifyingContract: "0x0000000000000000000000000000000000000001" as const },
      types: { Allocation: [{ name: "amount", type: "uint256" }] },
      primaryType: "Allocation" as const,
      message: { amount: 5n },
    };
    // The same call the app makes: the domain type is added for the wallet, then the wallet signs the JSON.
    const call = walletCall({ kind: "typed-data", typedData: { ...typedData, message: { amount: "5" } } } as never, expected);
    const signature = (await createMeraProvider(freshPrf(), expected).request({ method: call.method, params: call.params })) as Hex;
    expect(await verifyTypedData({ address: expected, ...typedData, signature })).toBe(true);
  });

  test("a passkey that is not the owner account signs nothing", async () => {
    const provider = createMeraProvider(freshPrf(OTHER_PRF), expected);
    await expect(provider.request({ method: "personal_sign", params: [messageHex("hello"), expected] })).rejects.toThrow("not the account");
  });

  test("the PRF bytes are zeroed once a signature is made", async () => {
    let held: Uint8Array | null = null;
    const prf = async () => (held = Uint8Array.from(PRF));
    await createMeraProvider(prf, expected).request({ method: "personal_sign", params: [messageHex("hello"), expected] });
    expect(held!.every((b) => b === 0)).toBe(true);
  });

  test("asks the passkey for every signature and keeps nothing between them", async () => {
    let prompts = 0;
    const provider = createMeraProvider(async () => (prompts++, Uint8Array.from(PRF)), expected);
    await provider.request({ method: "personal_sign", params: [messageHex("one"), expected] });
    await provider.request({ method: "personal_sign", params: [messageHex("two"), expected] });
    expect(prompts).toBe(2);
  });

  test("answers an unsupported method with the EIP-1193 unsupported code, and a chain switch with null", async () => {
    const provider = createMeraProvider(freshPrf(), expected);
    expect(await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x279f" }] })).toBeNull();
    await expect(provider.request({ method: "eth_sendTransaction", params: [{}] })).rejects.toMatchObject({ code: 4200 });
  });
});
