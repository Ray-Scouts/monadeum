import { createPublicClient, http, parseAbi, type Abi, type PublicClient } from "viem";
import { CONTRACT_NAMES, RECORDED_CAPITAL_FLOOR, type ContractName, type DeploymentRecord } from "./deployments";
import { CHAIN_ID, EVIDENCE_RPC } from "./explorer";
import type { Evidence, Verification } from "./types";

// Re-verification of every record against the chain, in the visitor's browser (ARCHITECTURE.md section 10, "Public
// evidence endpoint"). The rule is fail closed: a record is `verified` only when each comparison matched; a mismatch,
// a missing or reverted receipt, a malformed value, an RPC error, or an unreachable RPC is `unverified`.

export interface ChainReceipt {
  status: "success" | "reverted";
  blockNumber: bigint;
  from: string;
  to: string | null;
  contractAddress: string | null;
  logs: { address: string; logIndex: number }[];
}

/** What the verifier needs from the chain. `viemReader` implements it over the public RPC; tests implement it in memory. */
export interface ChainReader {
  chainId(): Promise<number>;
  /** The receipt, or null when the node has no such transaction. */
  receipt(hash: string): Promise<ChainReceipt | null>;
  /** Size in bytes of the code at `address`; 0 for an account with none. */
  codeSize(address: string): Promise<number>;
  /** A view call of the documented ABI below. */
  read(address: string, fn: ReadFn, args?: readonly unknown[]): Promise<unknown>;
}

const ABI = parseAbi([
  "function operator() view returns (address)",
  "function admin() view returns (address)",
  "function minEvaluationInterval() view returns (uint256)",
  "function capitalFloor() view returns (uint256)",
  "function settlementAsset() view returns (address)",
  "function currentEvaluation() view returns (uint256)",
  "function lastEvaluationAt() view returns (uint256)",
  "function agent(address account) view returns ((address owner, uint8 status, uint256 principal))",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
]) as Abi;

export type ReadFn = "operator" | "admin" | "minEvaluationInterval" | "capitalFloor" | "settlementAsset" | "currentEvaluation" | "lastEvaluationAt" | "agent" | "getThreshold" | "getOwners";

export function viemReader(rpcUrl: string = EVIDENCE_RPC): ChainReader {
  const client: PublicClient = createPublicClient({ transport: http(rpcUrl, { batch: true, timeout: 15_000, retryCount: 1 }) });
  return {
    chainId: () => client.getChainId(),
    async receipt(hash) {
      try {
        const r = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
        return {
          status: r.status,
          blockNumber: r.blockNumber,
          from: r.from,
          to: r.to,
          contractAddress: r.contractAddress ?? null,
          logs: r.logs.map((l) => ({ address: l.address, logIndex: l.logIndex })),
        };
      } catch (error) {
        if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") return null;
        throw error;
      }
    },
    async codeSize(address) {
      const code = await client.getCode({ address: address as `0x${string}` });
      return code && code !== "0x" ? (code.length - 2) / 2 : 0;
    },
    read: (address, fn, args) => client.readContract({ address: address as `0x${string}`, abi: ABI, functionName: fn, ...(args ? { args } : {}) } as never),
  };
}

// Keys of the results map. The UI reads results by these keys; an absent key is `checking`.
export const keys = {
  chain: "chain",
  deployTx: (name: ContractName) => `deploy-tx:${name}`,
  code: (address: string) => `code:${address.toLowerCase()}`,
  read: (address: string, fn: string) => `read:${address.toLowerCase()}:${fn}`,
  event: (hash: string, logIndex: number) => `event:${hash.toLowerCase()}:${logIndex}`,
  trade: (hash: string) => `trade:${hash.toLowerCase()}`,
  payment: (hash: string) => `payment:${hash.toLowerCase()}`,
  agentStatus: (account: string) => `agent-status:${account.toLowerCase()}`,
};

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const lower = (v: string | null | undefined) => (v ?? "").toLowerCase();
const unverified = (reason: string): Verification => ({ state: "unverified", reason });
const message = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0]! : String(e));

export interface ReceiptExpectation {
  block?: bigint;
  from?: string;
  /** Expected recipient; `null` expects a contract creation. Omitted: not compared. */
  to?: string | null;
  contractAddress?: string;
  /** A log the transaction must contain: the emitting contract and the log's index in its block. */
  log?: { address: string; logIndex: number };
  /** The contract address the record names; checked against the recorded one when given. */
  emitter?: { actual: string; expected: string };
}

/** Re-reads one transaction and compares it with what the record says. */
export async function verifyReceipt(reader: ChainReader, hash: string, expect: ReceiptExpectation = {}): Promise<Verification> {
  if (!HASH.test(hash)) return unverified("the transaction hash is malformed");
  if (expect.emitter && lower(expect.emitter.actual) !== lower(expect.emitter.expected)) return unverified("the record names a contract other than the deployed one");
  let receipt: ChainReceipt | null;
  try {
    receipt = await reader.receipt(hash);
  } catch (error) {
    return unverified(`the RPC did not answer: ${message(error)}`);
  }
  if (!receipt) return unverified("the chain has no receipt for this hash");
  if (receipt.status !== "success") return unverified("the transaction reverted");
  if (expect.block !== undefined && receipt.blockNumber !== expect.block) return unverified(`included in block ${receipt.blockNumber}, not ${expect.block}`);
  if (expect.from !== undefined && lower(receipt.from) !== lower(expect.from)) return unverified("the sender differs from the record");
  if (expect.to !== undefined && lower(receipt.to) !== lower(expect.to)) return unverified("the recipient differs from the record");
  if (expect.contractAddress !== undefined && lower(receipt.contractAddress) !== lower(expect.contractAddress)) return unverified("the created contract differs from the record");
  if (expect.log && !receipt.logs.some((l) => lower(l.address) === lower(expect.log!.address) && l.logIndex === expect.log!.logIndex)) {
    return unverified("the receipt has no log from that contract at that log index");
  }
  return { state: "verified", detail: `receipt status success in block ${receipt.blockNumber}`, chain: { blockNumber: receipt.blockNumber.toString(), from: receipt.from, to: receipt.to } };
}

/** Code size at an address: verified when there is code. */
export async function verifyCode(reader: ChainReader, address: string): Promise<Verification> {
  if (!ADDRESS.test(address)) return unverified("the address is malformed");
  try {
    const size = await reader.codeSize(address);
    return size > 0 ? { state: "verified", detail: `${size} bytes of code` } : unverified("no code at this address");
  } catch (error) {
    return unverified(`the RPC did not answer: ${message(error)}`);
  }
}

/** A view call compared with an expected value; with no expectation it only reports the value read. */
export async function verifyRead(reader: ChainReader, address: string, fn: ReadFn, expected?: string | bigint, args?: readonly unknown[]): Promise<Verification> {
  try {
    const actual = await reader.read(address, fn, args);
    const shown = Array.isArray(actual) ? actual.map(String).join(", ") : String(actual);
    if (expected === undefined) return { state: "verified", detail: shown };
    const same = typeof expected === "bigint" ? typeof actual === "bigint" && actual === expected : lower(String(actual)) === lower(expected);
    return same ? { state: "verified", detail: shown } : unverified(`the chain returns ${shown}, the record says ${String(expected)}`);
  } catch (error) {
    return unverified(`the call failed: ${message(error)}`);
  }
}

const AGENT_STATUS = ["Unregistered", "Active", "Retired"];

export interface Task {
  key: string;
  run(): Promise<Verification>;
}

/** Everything to check for one deployment record, in the order the page shows it. */
export function deploymentTasks(reader: ChainReader, d: DeploymentRecord): Task[] {
  const tasks: Task[] = [];
  const realloc = d.contracts.AgentReallocation;
  for (const name of CONTRACT_NAMES) {
    const tx = d.transactions[name];
    tasks.push({
      key: keys.deployTx(name),
      run: () => verifyReceipt(reader, tx.hash, { block: BigInt(tx.block), from: d.deployer, to: null, contractAddress: d.contracts[name] }),
    });
    tasks.push({ key: keys.code(d.contracts[name]), run: () => verifyCode(reader, d.contracts[name]) });
    tasks.push({ key: keys.read(d.contracts[name], "settlementAsset"), run: () => verifyRead(reader, d.contracts[name], "settlementAsset", d.inputs.settlementAsset) });
  }
  tasks.push({ key: keys.read(realloc, "operator"), run: () => verifyRead(reader, realloc, "operator", d.inputs.reallocationOperator) });
  tasks.push({ key: keys.read(realloc, "admin"), run: () => verifyRead(reader, realloc, "admin", d.inputs.reallocationAdmin) });
  tasks.push({ key: keys.read(realloc, "minEvaluationInterval"), run: () => verifyRead(reader, realloc, "minEvaluationInterval", BigInt(d.inputs.minEvaluationInterval)) });
  tasks.push({ key: keys.read(realloc, "capitalFloor"), run: () => verifyRead(reader, realloc, "capitalFloor", RECORDED_CAPITAL_FLOOR) });
  tasks.push({ key: keys.read(realloc, "currentEvaluation"), run: () => verifyRead(reader, realloc, "currentEvaluation") });
  tasks.push({ key: keys.read(realloc, "lastEvaluationAt"), run: () => verifyRead(reader, realloc, "lastEvaluationAt") });
  tasks.push({ key: keys.code(d.safe.address), run: () => verifyCode(reader, d.safe.address) });
  tasks.push({ key: keys.read(d.safe.address, "getThreshold"), run: () => verifyRead(reader, d.safe.address, "getThreshold", BigInt(d.safe.threshold)) });
  tasks.push({
    key: keys.read(d.safe.address, "getOwners"),
    run: async () => {
      const v = await verifyRead(reader, d.safe.address, "getOwners");
      if (v.state !== "verified") return v;
      const actual = v.detail.split(", ").map(lower).sort().join(",");
      return actual === d.safe.owners.map(lower).sort().join(",") ? v : unverified(`the chain returns ${v.detail}, the record lists other owners`);
    },
  });
  return tasks;
}

/** Everything to check for one evidence document. */
export function evidenceTasks(reader: ChainReader, d: DeploymentRecord, e: Evidence): Task[] {
  const tasks: Task[] = [];
  const policy = d.contracts.AgentSpendPolicy;
  const spendEvents = [...e.events.limitsSet.items, ...e.events.callAllowed.items, ...e.events.spent.items];
  const seen = new Set<string>();
  const add = (task: Task) => {
    if (!seen.has(task.key)) (seen.add(task.key), tasks.push(task));
  };
  for (const ev of e.events.deployed.items) {
    add({ key: keys.event(ev.transactionHash, ev.logIndex), run: () => verifyReceipt(reader, ev.transactionHash, { block: BigInt(ev.blockNumber), log: { address: ev.contract, logIndex: ev.logIndex } }) });
  }
  const realloc = d.contracts.AgentReallocation;
  for (const ev of [...e.reallocations.moved.items, ...e.reallocations.retired.items, ...e.reallocations.evaluationsAdvanced.items]) {
    add({ key: keys.event(ev.transactionHash, ev.logIndex), run: () => verifyReceipt(reader, ev.transactionHash, { block: BigInt(ev.blockNumber), log: { address: ev.contract, logIndex: ev.logIndex }, emitter: { actual: ev.contract, expected: realloc } }) });
  }
  for (const ev of spendEvents) {
    add({ key: keys.event(ev.transactionHash, ev.logIndex), run: () => verifyReceipt(reader, ev.transactionHash, { block: BigInt(ev.blockNumber), log: { address: ev.contract, logIndex: ev.logIndex }, emitter: { actual: ev.contract, expected: policy } }) });
  }
  const accounts = new Set<string>([...e.events.deployed.items.map((a) => a.account), ...e.trades.items.map((t) => t.account)]);
  for (const account of accounts) {
    add({ key: keys.code(account), run: () => verifyCode(reader, account) });
    add({
      key: keys.agentStatus(account),
      run: async () => {
        try {
          const row = (await reader.read(d.contracts.AgentReallocation, "agent", [account])) as { status?: number | bigint } | null;
          if (!row || row.status === undefined) return unverified("the call returned no status");
          const status = Number(row.status);
          return { state: "verified", detail: AGENT_STATUS[status] ?? `status ${status}` };
        } catch (error) {
          return unverified(`the call failed: ${message(error)}`);
        }
      },
    });
  }
  for (const t of e.trades.items) add({ key: keys.trade(t.transactionHash), run: () => verifyReceipt(reader, t.transactionHash, { block: BigInt(t.blockNumber) }) });
  for (const p of e.payments.items) add({ key: keys.payment(p.settlementTransaction), run: () => verifyReceipt(reader, p.settlementTransaction) });
  return tasks;
}

/**
 * Runs `tasks` four at a time and reports each result as it arrives, after first checking that the RPC answers for
 * chain 10143. With a wrong chain, or no answer, every task is reported `unverified` and none is sent. `shouldStop`
 * lets a refresh abandon a run: results of an abandoned run are not reported.
 */
export async function runChecks(reader: ChainReader, tasks: Task[], report: (key: string, v: Verification) => void, shouldStop: () => boolean = () => false): Promise<void> {
  let chainProblem: string | null = null;
  try {
    const id = await reader.chainId();
    if (id !== CHAIN_ID) chainProblem = `the RPC reports chain ${id}, not ${CHAIN_ID}`;
  } catch (error) {
    chainProblem = `the RPC is unreachable: ${message(error)}`;
  }
  if (shouldStop()) return;
  report(keys.chain, chainProblem ? unverified(chainProblem) : { state: "verified", detail: `chain ${CHAIN_ID}` });
  if (chainProblem) {
    for (const t of tasks) report(t.key, unverified(chainProblem));
    return;
  }
  let next = 0;
  const worker = async () => {
    while (!shouldStop()) {
      const task = tasks[next++];
      if (!task) return;
      let result: Verification;
      try {
        result = await task.run();
      } catch (error) {
        result = unverified(`the check failed: ${message(error)}`);
      }
      if (!shouldStop()) report(task.key, result);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
