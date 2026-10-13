import { formatUnits, isAddress, parseUnits } from "viem";
import { FUNDING_RULE } from "../funding";
import { ApiError } from "./client";
import { detailSuffix, plainThrown } from "./plain";
import type { Explanation } from "./signing";
import type { FundingInfo, FundingPrepared, FundingView, Operation } from "./types";

/**
 * "Fund this agent" in `api` mode (ARCHITECTURE.md sections 6.1 and 7). The owner enters an amount in USDC; the API
 * builds an EIP-3009 authorization from the owner wallet on record to the agent's deployed account; the owner's wallet
 * signs it; a platform relayer submits it and pays the gas. Every state shown here is what the API answered.
 */

/** Monad testnet's block explorer. The relayer is testnet only, so every transaction this card links is on testnet. */
export const TESTNET_EXPLORER = "https://testnet.monadexplorer.com";

export const txUrl = (hash: string) => `${TESTNET_EXPLORER}/tx/${hash}`;

export const FUNDING_COPY = {
  what: `Move USDC from your owner wallet to this agent's account. You sign one authorization in your wallet; the platform submits it and pays the network fee, so your wallet needs no MON.`,
  rule: FUNDING_RULE,
  after: "Principal updates once the transfer is finalized on chain and indexed, usually within a few minutes. Until then the agent's principal shows the earlier value.",
};

const USDC_DECIMALS = 6;

/** `n` base units as USDC for display, e.g. "2.5 USDC". */
export const usdc = (baseUnits: string | bigint, decimals = USDC_DECIMALS) => `${formatUnits(BigInt(baseUnits), decimals)} USDC`;

/** Converts the amount field to base units and checks it against the card's limits. Returns the value or the error to show. */
export function fundingAmount(raw: string, info: Pick<FundingInfo, "decimals" | "maxPerTransfer" | "ownerBalance">): { ok: true; value: string } | { ok: false; error: string } {
  const decimals = info.decimals ?? USDC_DECIMALS;
  const v = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) return { ok: false, error: "Enter an amount in USDC, such as 5 or 2.50." };
  if ((v.split(".")[1]?.length ?? 0) > decimals) return { ok: false, error: `At most ${decimals} decimal places.` };
  const value = parseUnits(v, decimals);
  if (value <= 0n) return { ok: false, error: "The amount must be more than 0." };
  if (value > BigInt(info.maxPerTransfer)) return { ok: false, error: `At most ${usdc(info.maxPerTransfer, decimals)} per transfer.` };
  if (info.ownerBalance !== null && value > BigInt(info.ownerBalance)) return { ok: false, error: `Your owner wallet holds ${usdc(info.ownerBalance, decimals)}.` };
  return { ok: true, value: value.toString() };
}

/** Why the card cannot be used right now, or null when it can. */
export function fundingBlocked(info: FundingInfo): string | null {
  if (info.chainError) return "The API could not read the chain just now, so it cannot tell whether the account is deployed or what your wallet holds. Nothing was changed. Reload the page in a moment.";
  if (info.retired) return "This agent is retired, so it cannot be funded.";
  if (!info.deployed) return "The agent's account is not deployed yet. Funds sent before deployment would not count as principal, so funding opens once the account is deployed.";
  if (info.daily.remaining === 0) return `You have used all ${info.daily.limit} relayed transfers for the last 24 hours. The next one opens as the oldest leaves the window.`;
  if (info.ownerBalance === "0") return "Your owner wallet holds no USDC, so there is nothing to send yet. Add USDC to the owner wallet on the Monad testnet, then reload this page.";
  return null;
}

/** The prepared authorization as a signature request, so it is shown and signed like every owner-signed operation. */
export function fundingOperation(prepared: FundingPrepared, owner: string): Operation {
  return {
    id: prepared.funding.nonce,
    kind: "fund",
    agentIds: [prepared.agent.id],
    owner,
    status: "awaiting-signature",
    signatureRequest: { id: prepared.funding.nonce, expiresAt: prepared.expiresAt, kind: "typed-data", typedData: prepared.typedData },
    result: null,
    error: null,
  };
}

/** What the owner is about to sign, in plain words, checked against the typed data itself. */
export function explainFunding(prepared: FundingPrepared, owner: string): Explanation {
  const m = prepared.typedData.message;
  const to = String(m.to);
  const from = String(m.from);
  const value = String(m.value);
  const problems: string[] = [];
  if (from.toLowerCase() !== owner.toLowerCase()) problems.push("the sender is not your owner wallet");
  if (prepared.typedData.primaryType !== "TransferWithAuthorization") problems.push("it is not a USDC transfer authorization");
  if (!isAddress(to, { strict: false }) || to.toLowerCase() !== prepared.funding.to.toLowerCase()) problems.push("the recipient differs from the agent's account");
  if (value !== prepared.funding.value) problems.push("the amount differs from the one requested");
  return {
    summary: `Move ${usdc(value, prepared.decimals)} from your owner wallet to ${prepared.agent.name}'s account.`,
    details: [
      `From your owner wallet ${from}.`,
      `To the agent's account ${to}. The recipient and the amount are part of what you sign, so nobody can change them afterwards.`,
      `Your wallet will show structured data of type TransferWithAuthorization from ${String(prepared.typedData.domain.name)} on chain ${String(prepared.typedData.domain.chainId)}.`,
      "The platform submits it and pays the network fee. It is valid once.",
      `The authorization expires at ${new Date(prepared.expiresAt).toLocaleTimeString()}; after that, prepare a new one.`,
    ],
    caution: problems.length ? `Do not sign: ${problems.join("; ")}.` : null,
  };
}

export type FundingStep =
  | { state: "idle" }
  | { state: "preparing" }
  | { state: "signing"; prepared: FundingPrepared }
  | { state: "pending"; funding: FundingView; message: string }
  | { state: "confirmed"; funding: FundingView; message: string }
  | { state: "failed"; funding: FundingView | null; message: string };

/** The card's state for an authorization the API reports. */
export function fundingStep(funding: FundingView, decimals = USDC_DECIMALS): FundingStep {
  const amount = usdc(funding.value, decimals);
  switch (funding.status) {
    case "confirmed":
      return { state: "confirmed", funding, message: `Confirmed: ${amount} arrived in the agent's account${funding.blockNumber ? ` in block ${funding.blockNumber}` : ""}. ${FUNDING_COPY.after}` };
    case "failed":
      return {
        state: "failed",
        funding,
        message: `The transfer failed. ${funding.error === "not-included" ? "It expired without being included, so no USDC moved." : "No USDC moved."} You can prepare a new one.`,
      };
    case "expired":
      return { state: "failed", funding, message: "The authorization expired before it was submitted. Nothing moved; prepare a new one." };
    case "submitted":
      return { state: "pending", funding, message: `Submitted. Waiting for the network to include the transfer of ${amount}.` };
    default:
      return { state: "pending", funding, message: "Prepared, waiting for your signature." };
  }
}

/** The API's refusal of a funding step, in plain language. */
export function fundingErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.reason) {
      case "funding-unavailable":
        return "This server has no funding relayer configured, so it cannot submit transfers. Nothing was changed.";
      case "account-not-deployed":
        return "The agent's account is not deployed yet, so it cannot be funded. Nothing was changed.";
      case "insufficient-balance":
        return "Your owner wallet does not hold that much USDC. Nothing was changed.";
      case "limit-too-high":
        return `That is above the per-transfer limit${detailSuffix(error.detail)}. Enter a smaller amount. Nothing was changed.`;
      case "funding-budget-exceeded":
        return "You have used all relayed transfers for the last 24 hours. Nothing was submitted.";
      case "too-many-open-authorizations":
        return "You have several unsigned authorizations open. Sign one, or wait for them to expire. Nothing was changed.";
      case "relayer-balance-low":
        return "The platform's relayer does not hold enough MON to pay the network fee right now, so nothing was submitted. Your signature was not used; try again later.";
      case "bad-signature":
        return "The signature does not match your owner wallet and this authorization, so it was refused. Nothing was submitted.";
      case "authorization-expired":
        return "This authorization expired. Nothing was submitted; prepare a new one.";
      case "relay-simulation-failed":
        return `The USDC contract would refuse this transfer${detailSuffix(error.detail)}, so nothing was submitted. Check your balance and the amount, then prepare a new one.`;
      case "already-submitted":
        return "This authorization was already submitted. Check its status below.";
      case "settlement-asset-unverified":
      case "chain-unavailable":
        return "The API could not read the chain, so nothing was prepared or submitted. Try again shortly.";
      case "network-error":
        return "The API could not be reached. If you had signed, check the status below before signing again.";
    }
    if (error.status === 401) return "Your session has ended. Sign in again, then retry.";
    return `The API refused the request (${error.reason})${detailSuffix(error.detail)}. Nothing was submitted. Reload the page and try again.`;
  }
  return plainThrown(error, "Funding failed. Nothing was submitted. Reload the page and try again.");
}
