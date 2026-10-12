import { describe, expect, test } from "bun:test";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ApiError, createApiClient } from "./client";
import { explainFunding, fundingAmount, fundingBlocked, fundingErrorText, fundingOperation, fundingStep, txUrl } from "./funding";
import { signWith, type Eip1193 } from "./signing";
import type { FundingInfo, FundingPrepared, FundingView } from "./types";

// "Fund this agent" in the data layer: requests, amount checks, the signature request, and the status lines.

const owner = privateKeyToAccount(generatePrivateKey());
const ACCOUNT = "0x00000000000000000000000000000000000000ac";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const NONCE = `0x${"ab".repeat(32)}`;

const info = (over: Partial<FundingInfo> = {}): FundingInfo => ({
  asset: USDC,
  decimals: 6,
  chainId: 10143,
  owner: owner.address,
  account: ACCOUNT,
  deployed: true,
  retired: false,
  ownerBalance: "20000000",
  maxPerTransfer: "10000000",
  daily: { limit: 3, used: 0, remaining: 3 },
  relayer: "0x00000000000000000000000000000000000000e1",
  chainError: null,
  recent: [],
  ...over,
});

const view = (over: Partial<FundingView> = {}): FundingView => ({
  nonce: NONCE,
  agentId: "a1",
  status: "prepared",
  from: owner.address,
  to: ACCOUNT,
  value: "2500000",
  validAfter: "1000",
  validBefore: "1600",
  txHash: null,
  blockNumber: null,
  submittedAt: null,
  error: null,
  ...over,
});

const prepared = (over: { to?: string; value?: string; from?: string } = {}): FundingPrepared => ({
  funding: view(),
  agent: { id: "a1", name: "alpha" },
  decimals: 6,
  expiresAt: 1_600_000,
  typedData: {
    domain: { name: "USDC", version: "2", chainId: 10143, verifyingContract: USDC },
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
    message: { from: over.from ?? owner.address, to: over.to ?? ACCOUNT, value: over.value ?? "2500000", validAfter: "1000", validBefore: "1600", nonce: NONCE },
  },
});

describe("funding requests", () => {
  test("prepare sends only the value; submit sends only the nonce and the signature; status reads by nonce", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ funding: view() }), { status: 200 });
    };
    const s = createApiClient("https://api.example.test", fetch).as({ via: "privy", accessToken: async () => "tok" });
    await s.fundingInfo("a1");
    await s.prepareFunding("a1", "2500000");
    await s.submitFunding("a1", NONCE, "0xsig");
    await s.fundingStatus("a1", NONCE);
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "GET https://api.example.test/agents/a1/funding",
      "POST https://api.example.test/agents/a1/funding/prepare",
      "POST https://api.example.test/agents/a1/funding/submit",
      `GET https://api.example.test/agents/a1/funding/${NONCE}`,
    ]);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ value: "2500000" });
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({ nonce: NONCE, signature: "0xsig" });
  });
});

describe("the amount", () => {
  test("converts USDC to base units and checks the per-transfer limit and the owner's balance", () => {
    expect(fundingAmount("2.5", info())).toEqual({ ok: true, value: "2500000" });
    expect(fundingAmount("0.000001", info())).toEqual({ ok: true, value: "1" });
    expect(fundingAmount("0", info()).ok).toBe(false);
    expect(fundingAmount("abc", info()).ok).toBe(false);
    expect(fundingAmount("1.0000001", info())).toEqual({ ok: false, error: "At most 6 decimal places." });
    expect(fundingAmount("10.000001", info())).toEqual({ ok: false, error: "At most 10 USDC per transfer." });
    expect(fundingAmount("5", info({ ownerBalance: "4000000" }))).toEqual({ ok: false, error: "Your owner wallet holds 4 USDC." });
  });

  test("the card is closed for an undeployed or retired agent and when the daily relays are spent", () => {
    expect(fundingBlocked(info())).toBeNull();
    expect(fundingBlocked(info({ deployed: false }))).toMatch(/not deployed/);
    expect(fundingBlocked(info({ retired: true }))).toMatch(/retired/);
    expect(fundingBlocked(info({ daily: { limit: 3, used: 3, remaining: 0 } }))).toMatch(/all 3 relayed transfers/);
  });
});

describe("the signature request", () => {
  test("summarizes the amount and recipient in plain words, with no caution when the typed data matches", () => {
    const e = explainFunding(prepared(), owner.address);
    expect(e.summary).toBe("Move 2.5 USDC from your owner wallet to alpha's account.");
    expect(e.details.join(" ")).toContain(ACCOUNT);
    expect(e.caution).toBeNull();
  });

  test("warns not to sign when the typed data names another recipient, amount, or sender", () => {
    expect(explainFunding(prepared({ to: "0x00000000000000000000000000000000000000bd" }), owner.address).caution).toMatch(/recipient/);
    expect(explainFunding(prepared({ value: "9" }), owner.address).caution).toMatch(/amount/);
    expect(explainFunding(prepared({ from: ACCOUNT }), owner.address).caution).toMatch(/sender/);
  });

  test("the owner's wallet signs the EIP-712 typed data, and the signature recovers the owner", async () => {
    const p = prepared();
    const provider: Eip1193 = {
      async request({ method, params }) {
        expect(method).toBe("eth_signTypedData_v4");
        const [address, json] = params as [string, string];
        expect(address).toBe(owner.address);
        const td = JSON.parse(json);
        expect(td.types.EIP712Domain).toBeDefined();
        const message = { ...td.message, value: BigInt(td.message.value), validAfter: BigInt(td.message.validAfter), validBefore: BigInt(td.message.validBefore) };
        return owner.signTypedData({ domain: td.domain, types: { TransferWithAuthorization: td.types.TransferWithAuthorization }, primaryType: td.primaryType, message });
      },
    };
    const op = fundingOperation(p, owner.address);
    expect(op.kind).toBe("fund");
    const signature = await signWith(provider, owner.address, op);
    const m = p.typedData.message;
    const recovered = await recoverTypedDataAddress({
      domain: { name: "USDC", version: "2", chainId: 10143, verifyingContract: USDC },
      types: { TransferWithAuthorization: p.typedData.types.TransferWithAuthorization! },
      primaryType: "TransferWithAuthorization",
      message: { from: m.from as `0x${string}`, to: m.to as `0x${string}`, value: 2_500_000n, validAfter: 1000n, validBefore: 1600n, nonce: NONCE as `0x${string}` },
      signature: signature as `0x${string}`,
    });
    expect(recovered).toBe(owner.address);
    await expect(signWith(provider, ACCOUNT, op)).rejects.toThrow(/not this account's owner wallet/);
  });
});

describe("status", () => {
  test("pending, confirmed with the principal note, failed, and expired", () => {
    expect(fundingStep(view({ status: "submitted", txHash: `0x${"1".repeat(64)}` })).state).toBe("pending");
    const confirmed = fundingStep(view({ status: "confirmed", txHash: `0x${"1".repeat(64)}`, blockNumber: "77" }));
    expect(confirmed.state).toBe("confirmed");
    expect("message" in confirmed && confirmed.message).toMatch(/2.5 USDC arrived.*block 77.*Principal updates once the transfer is finalized on chain and indexed/);
    expect(fundingStep(view({ status: "failed", error: "not-included" })).state).toBe("failed");
    const expired = fundingStep(view({ status: "expired" }));
    expect(expired.state).toBe("failed");
    expect(txUrl("0xabc")).toBe("https://testnet.monadexplorer.com/tx/0xabc");
  });

  test("refusals in plain language, saying what did not happen", () => {
    expect(fundingErrorText(new ApiError(503, "relayer-balance-low"))).toMatch(/nothing was submitted/);
    expect(fundingErrorText(new ApiError(429, "funding-budget-exceeded"))).toMatch(/24 hours/);
    expect(fundingErrorText(new ApiError(409, "account-not-deployed"))).toMatch(/not deployed/);
    expect(fundingErrorText(new ApiError(400, "bad-signature"))).toMatch(/refused/);
    expect(fundingErrorText(new ApiError(503, "funding-unavailable"))).toMatch(/no funding relayer/);
  });
});
