import { isHex, stringToHex } from "viem";
import type { MessagePayload, Operation, SignatureRequest, TypedDataPayload } from "./types";

/**
 * Owner-signed operations, client side. The API relays each signature request to the owner's wallet; this module turns
 * a request into the EIP-1193 call the wallet answers and into plain language the owner can read before signing. Only
 * the resulting signature is posted back. No key is read, held, or sent: the wallet signs inside its own UI.
 */

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface WalletCall {
  method: "personal_sign" | "eth_signTypedData_v4";
  params: [string, string];
}

/** The bytes an EIP-191 message signs, as hex: UTF-8 for a string, as given for `{ raw }`. */
export function messageHex(message: MessagePayload): `0x${string}` {
  if (typeof message === "string") return stringToHex(message);
  if (typeof message.raw !== "string" || !isHex(message.raw)) throw new Error("the signature request's raw message is not hex");
  return message.raw;
}

const DOMAIN_FIELDS: [string, string][] = [
  ["name", "string"],
  ["version", "string"],
  ["chainId", "uint256"],
  ["verifyingContract", "address"],
  ["salt", "bytes32"],
];

/**
 * `eth_signTypedData_v4` expects `types.EIP712Domain`, which the API's viem-style definition leaves implicit. It is
 * derived from the domain's own fields, in the order EIP-712 fixes, so the digest equals the one the API verifies.
 */
export function withDomainType(typedData: TypedDataPayload): TypedDataPayload {
  if (typedData.types.EIP712Domain) return typedData;
  const EIP712Domain = DOMAIN_FIELDS.filter(([name]) => typedData.domain[name] !== undefined).map(([name, type]) => ({ name, type }));
  return { ...typedData, types: { EIP712Domain, ...typedData.types } };
}

export function walletCall(request: SignatureRequest, address: string): WalletCall {
  if (request.kind === "message") return { method: "personal_sign", params: [messageHex(request.message), address] };
  return { method: "eth_signTypedData_v4", params: [address, JSON.stringify(withDomainType(request.typedData))] };
}

export const sameAddress = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Asks the wallet to sign. Refuses when the wallet's account is not the operation's owner, which the API would refuse too. */
export async function signWith(provider: Eip1193, address: string, operation: Operation): Promise<string> {
  const request = operation.signatureRequest;
  if (!request) throw new Error("this operation is not waiting for a signature");
  if (!sameAddress(address, operation.owner)) throw new Error(`the connected wallet ${address} is not this account's owner wallet ${operation.owner}`);
  const call = walletCall(request, address);
  const signature = await provider.request({ method: call.method, params: call.params });
  if (typeof signature !== "string" || !isHex(signature)) throw new Error("the wallet did not return a signature");
  return signature;
}

export interface Explanation {
  /** One sentence: what the owner authorizes. */
  summary: string;
  /** Plain-language facts about this request, in reading order. */
  details: string[];
  /** Set when the wallet will show something the owner cannot check against the summary. */
  caution: string | null;
}

const KIND_SUMMARY: Record<Operation["kind"], (names: string) => string> = {
  deploy: (names) => `Deploy the smart account for ${names}, owned by your wallet, with the spending limits you chose.`,
  revoke: (names) =>
    `Revoke ${names}'s session key on chain: remove its permission from the agent's account so the key cannot sign for it again. The agent's balance stays in its account.`,
  policy: (names) => `Sign a reallocation policy covering ${names}. It allows capital to move only between these agents of yours, within the protocol bounds.`,
  activate: (names) =>
    `Activate ${names}: approve a session key that can make only the allowlisted calls from the agent's account, within the spending limits set on chain. You can revoke it at any time with "Stop this agent".`,
  fund: (names) => `Move USDC from your owner wallet to ${names}'s account.`,
};

const listNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? "this agent") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** What the owner is about to sign, in plain language. `name` resolves an agent ID to its display name. */
export function explain(operation: Operation, name: (agentId: string) => string = (id) => id): Explanation {
  const names = listNames(operation.agentIds.map(name));
  const summary = KIND_SUMMARY[operation.kind](names);
  const request = operation.signatureRequest;
  const details: string[] = [`Signed by your owner wallet ${operation.owner}.`];
  let caution: string | null = null;
  if (request?.kind === "message") {
    const hex = messageHex(request.message);
    if (hex.length === 66) {
      details.push("Your wallet will show a 32-byte value. It is the hash of the account operation that carries out the step above.");
      caution =
        "This page cannot recompute that hash from the calls it authorizes, so it cannot prove the two match. Sign it only if you started this action here, just now.";
    } else {
      details.push("Your wallet will show a text message to sign.");
    }
  } else if (request?.kind === "typed-data") {
    const td = request.typedData;
    const domain = typeof td.domain.name === "string" ? td.domain.name : "an unnamed domain";
    details.push(`Your wallet will show structured data of type ${td.primaryType} from ${domain}${td.domain.chainId !== undefined ? ` on chain ${String(td.domain.chainId)}` : ""}.`);
    if (operation.kind === "policy") details.push("The policy is recorded when you sign. It is not committed on chain until the reallocation contract is deployed.");
    if (operation.kind === "activate") {
      details.push(
        "This is Kernel's enable approval for the agent's account: it names the session key's permission, with the call allowlist and the account's spend policy attached to it. It sends no transaction and costs no gas.",
        "The permission is written to the account by the agent's first operation. Until then the approval is valid only while the account's nonce stays where it is now.",
      );
    }
  }
  if (request) details.push(`The request expires at ${new Date(request.expiresAt).toLocaleTimeString()}; after that the operation fails and you can start it again.`);
  return { summary, details, caution };
}

/** The exact payload, for the expandable raw view. Typed data is shown as the wallet receives it. */
export function rawPayload(request: SignatureRequest): string {
  if (request.kind === "typed-data") return JSON.stringify(withDomainType(request.typedData), null, 2);
  return typeof request.message === "string" ? request.message : JSON.stringify(request.message, null, 2);
}
