import type { DeploymentRecord } from "./deployments";
import { EVIDENCE_RPC } from "./explorer";
import type { Evidence } from "./types";

export interface Command {
  id: string;
  title: string;
  /** What a matching answer means. */
  expect: string;
  cast: string;
  viem: string;
}

const RPC = EVIDENCE_RPC;

/**
 * Commands a visitor can run to check each class of record without trusting this page. Values come from the
 * deployment record and, where the document has one, its first record; a class with no record shows a placeholder, never a
 * made-up hash.
 */
export function verifyCommands(d: DeploymentRecord, e: Evidence | null): Command[] {
  const realloc = d.contracts.AgentReallocation;
  const deployTx = d.transactions.AgentSpendPolicy.hash;
  const firstEvent = e?.events.limitsSet.items[0] ?? e?.events.spent.items[0] ?? e?.events.callAllowed.items[0] ?? null;
  const account = e?.events.deployed.items[0]?.account ?? "<ACCOUNT_ADDRESS>";
  const eventTx = firstEvent?.transactionHash ?? e?.events.deployed.items[0]?.transactionHash ?? "<TX_HASH>";
  const tradeTx = e?.trades.items[0]?.transactionHash ?? "<TX_HASH>";
  const payTx = e?.payments.items[0]?.settlementTransaction ?? "<TX_HASH>";
  const client = `import { createPublicClient, http, parseAbi } from "viem";\nconst client = createPublicClient({ transport: http("${RPC}") });`;
  const receipt = (hash: string) => `${client}\nconst r = await client.getTransactionReceipt({ hash: "${hash}" });\nconsole.log(r.status, r.blockNumber, r.from, r.to);`;
  return [
    {
      id: "deployment",
      title: "A deployment transaction",
      expect: `status success, block ${d.transactions.AgentSpendPolicy.block}, from the deployer ${d.deployer}, contractAddress ${d.contracts.AgentSpendPolicy}.`,
      cast: `cast receipt ${deployTx} --rpc-url ${RPC}`,
      viem: receipt(deployTx),
    },
    {
      id: "contract",
      title: "A contract exists and its documented reads",
      expect: `code is not 0x; operator, admin and settlementAsset equal the values on this page; minEvaluationInterval is ${d.inputs.minEvaluationInterval}.`,
      cast: `cast code ${realloc} --rpc-url ${RPC}\ncast call ${realloc} "operator()(address)" --rpc-url ${RPC}\ncast call ${realloc} "admin()(address)" --rpc-url ${RPC}\ncast call ${realloc} "minEvaluationInterval()(uint256)" --rpc-url ${RPC}\ncast call ${realloc} "capitalFloor()(uint256)" --rpc-url ${RPC}\ncast call ${realloc} "settlementAsset()(address)" --rpc-url ${RPC}`,
      viem: `${client}\nconst abi = parseAbi(["function operator() view returns (address)", "function minEvaluationInterval() view returns (uint256)"]);\nconsole.log(await client.getCode({ address: "${realloc}" }));\nconsole.log(await client.readContract({ address: "${realloc}", abi, functionName: "operator" }));\nconsole.log(await client.readContract({ address: "${realloc}", abi, functionName: "minEvaluationInterval" }));`,
    },
    {
      id: "agent",
      title: "An agent account and its policy events",
      expect: "the account has code; the receipt of a policy event transaction has status success and contains a log emitted by the AgentSpendPolicy address listed above.",
      cast: `cast code ${account} --rpc-url ${RPC}\ncast receipt ${eventTx} --rpc-url ${RPC}\ncast call ${realloc} "agent(address)((address,uint8,uint256))" ${account} --rpc-url ${RPC}`,
      viem: `${receipt(eventTx)}\nconsole.log(r.logs.map((l) => [l.address, l.logIndex]));`,
    },
    {
      id: "trade",
      title: "A trade fill",
      expect: "status success in the block listed for the trade.",
      cast: `cast receipt ${tradeTx} --rpc-url ${RPC}`,
      viem: receipt(tradeTx),
    },
    {
      id: "x402",
      title: "An x402 settlement",
      expect: "status success. The page lists a payment only when it carries a settlement transaction hash.",
      cast: `cast receipt ${payTx} --rpc-url ${RPC}`,
      viem: receipt(payTx),
    },
  ];
}
