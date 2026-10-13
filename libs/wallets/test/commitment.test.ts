import { AGENT_COMMITMENTS_ABI } from "@monadeum/commitment";
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, getAddress, keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MemoryAgentWalletStore, MemorySessionKeyVault, MemorySponsorshipLedger, WalletsService, buildScope, type OwnerSigner } from "../src/index.js";
import { FakeChain } from "../src/testing.js";

// ARCHITECTURE.md section 9, issue #32: with AgentCommitments configured, the account commits its genome and
// strategy-version hashes in the owner-signed operation that deploys it, and a deployment is not reported done unless
// the chain shows exactly those hashes.

const USDC = getAddress("0x00000000000000000000000000000000000000a1");
const ROUTER = getAddress("0x00000000000000000000000000000000000000b1");
const REALLOC = getAddress("0x00000000000000000000000000000000000000c1");
const REGISTRY = getAddress("0x00000000000000000000000000000000000000d1");
const scope = buildScope({ settlementAsset: USDC, kuruRouter: ROUTER, kuruRouterSelectors: ["0x12345678"], reallocation: REALLOC, reallocationSelectors: ["0x9abcdef0"] });
const limits = { perTxCap: 1_000_000n, dailyCap: 5_000_000n };
const hashes = { genomeHash: keccak256(toHex("genome")), strategyVersionHash: keccak256(toHex("strategy")) };

function owner(): OwnerSigner {
  const account = privateKeyToAccount(generatePrivateKey());
  return { address: account.address, signer: account };
}

function setup(registryDeployed = true) {
  const chain = new FakeChain();
  if (registryDeployed) chain.deployContract(REGISTRY);
  const service = new WalletsService(chain, new MemoryAgentWalletStore(), new MemorySessionKeyVault(), new MemorySponsorshipLedger(), {
    scope, budget: { operations: 5, gasWei: 100_000n }, paymaster: true, commitments: REGISTRY,
  });
  return { chain, service, owner: owner() };
}

test("deployment commits the genome and strategy-version hashes from the new account, in the same operation", async () => {
  const { chain, service, owner: o } = setup();
  const r = await service.deploy({ agentId: "agent-1", owner: o, index: 0n, limits, commitment: hashes });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(chain.submitted.length, 1);
  const commits = chain.submitted[0]!.calls.filter((c) => c.to === REGISTRY);
  assert.equal(commits.length, 1);
  assert.equal(commits[0]!.value, 0n);
  assert.deepEqual(decodeFunctionData({ abi: AGENT_COMMITMENTS_ABI, data: commits[0]!.data }).args, [hashes.genomeHash, hashes.strategyVersionHash]);
  assert.deepEqual(await chain.agentCommitment(REGISTRY, r.account), hashes);
  // Idempotent: a repeat sends nothing and still checks the commitment.
  const again = await service.deploy({ agentId: "agent-1", owner: o, index: 0n, limits, commitment: hashes });
  assert.deepEqual(again, { ok: true, account: r.account, created: false, operation: null });
  assert.equal(chain.submitted.length, 1);
});

test("with commitments configured, a deployment without both hashes is refused before anything is sent", async () => {
  const { chain, service, owner: o } = setup();
  const zero = `0x${"0".repeat(64)}` as Hex;
  for (const commitment of [undefined, { ...hashes, genomeHash: zero }, { ...hashes, strategyVersionHash: "0x1234" as Hex }]) {
    const r = await service.deploy({ agentId: "agent-1", owner: o, index: 0n, limits, commitment });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "misconfigured");
  }
  assert.equal(chain.submitted.length, 0);
});

test("a commitments contract without code is refused, since a call to it would succeed silently", async () => {
  const { chain, service, owner: o } = setup(false);
  const r = await service.deploy({ agentId: "agent-1", owner: o, index: 0n, limits, commitment: hashes });
  assert.deepEqual(r, { ok: false, reason: "misconfigured", detail: "the agent commitments contract has no code" });
  assert.equal(chain.submitted.length, 0);
});

test("an account that is already deployed with other hashes is not reported deployed", async () => {
  const { chain, service, owner: o } = setup();
  const r = await service.deploy({ agentId: "agent-1", owner: o, index: 0n, limits, commitment: hashes });
  assert.equal(r.ok, true);
  const other = { ...hashes, genomeHash: keccak256(toHex("another genome")) };
  const again = await service.deploy({ agentId: "agent-1", owner: o, index: 0n, limits, commitment: other });
  assert.equal(again.ok, false);
  if (!again.ok) assert.match(again.detail ?? "", /genome commitment does not match/);
  assert.equal(chain.submitted.length, 1);
});

test("without commitments configured, deployment sends no commit call", async () => {
  const chain = new FakeChain();
  const service = new WalletsService(chain, new MemoryAgentWalletStore(), new MemorySessionKeyVault(), new MemorySponsorshipLedger(), {
    scope, budget: { operations: 5, gasWei: 100_000n }, paymaster: true,
  });
  const r = await service.deploy({ agentId: "agent-1", owner: owner(), index: 0n, limits, commitment: hashes });
  assert.equal(r.ok, true);
  assert.equal(chain.submitted[0]!.calls.some((c) => c.to === REGISTRY), false);
});
