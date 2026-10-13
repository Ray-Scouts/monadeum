import record from "../../../../../contracts/deployments/monad-testnet.json";

/**
 * `contracts/deployments/monad-testnet.json`, the committed deployment record, typed for the evidence page. The page
 * compares it with the chain; it does not trust it.
 */
export interface DeploymentRecord {
  chainId: number;
  status: string;
  deployer: string;
  inputs: { settlementAsset: string; settlementDecimals: number; reallocationOperator: string; reallocationAdmin: string; minEvaluationInterval: number };
  contracts: { AgentSpendPolicy: string; AgentReallocation: string; X402PaymentValidator: string };
  deploymentBlock: number;
  transactions: Record<ContractName, { hash: string; block: number; nonce: number; gasUsed: number }>;
  cost: { totalGas: number; effectiveGasPriceWei: string; totalMon: string };
  verified: string;
  safe: { address: string; version: string; threshold: number; owners: string[]; checked: string };
}

export type ContractName = "AgentSpendPolicy" | "AgentReallocation" | "X402PaymentValidator";
export const CONTRACT_NAMES: readonly ContractName[] = ["AgentSpendPolicy", "AgentReallocation", "X402PaymentValidator"];

/**
 * `capitalFloor()` as the record's own `verified` note states it (60000 settlement-asset base units); the JSON keeps
 * it only in that sentence, so it is stated once here and compared with the chain.
 */
export const RECORDED_CAPITAL_FLOOR = 60_000n;

export const DEPLOYMENT: DeploymentRecord = record as unknown as DeploymentRecord;
