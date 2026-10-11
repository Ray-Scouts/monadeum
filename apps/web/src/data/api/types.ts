// Response shapes of `apps/api`, as its README and controllers define them. Integers that can exceed 2^53 arrive as
// decimal strings (the API's `jsonSafe`), so they are typed as strings here and never parsed into a number for math.

export interface ApiUser {
  id: string;
  ownerWallet: string | null;
  wallets: { address: string; kind: "embedded" | "external"; linkedAt: number }[];
  privyLinked: boolean;
  createdAt: number;
}

/** `GET /auth/me`. `via` is which credential authenticated the request. */
export interface MeResponse {
  user: ApiUser;
  via: "privy" | "wallet";
  expiresAt: number;
}

export interface WalletChallenge {
  nonce: string;
  message: string;
  expiresAt: number;
}

/** `GET /population`: platform aggregates, no agent identified. */
export interface PopulationResponse {
  agents: number;
  accounts: { tracked: number; deployed: number };
  liveSessionKeys: number;
  totalSpent: string;
  cursor: { blockNumber: string; blockHash: string } | null;
  /** The fields below are optional: an API built before they existed omits them, and the screens show them as pending. */
  /** Trades by every live agent, all owners. */
  trades?: number | null;
  /** x402 purchases by every agent, all owners. */
  x402?: X402Totals | null;
  /** The last evaluation the worker completed, `at` in milliseconds since the epoch. */
  lastEvaluation?: { sequence: number; at: number } | null;
  /** Sum of the live agents' capital at the last evaluation, base units. */
  capital?: string | null;
}

/** x402 purchases and their cost, base units, split by provider. */
export interface X402Totals {
  purchases: number;
  spent: string;
  byProvider: { provider: string; spent: string }[];
}

export interface OwnerPolicyView {
  agentIds: string[];
  reallocationCap: number | null;
  slotCeiling: number | null;
  signedAtEvaluation: null;
  sequence: number;
  policyHash: string;
}

/** The deployment's reallocation switch, as the API reports it (`MONADEUM_REALLOCATION_ENABLED`). */
export interface ReallocationStatus {
  enabled: boolean;
  /** Why it is off; null when it is on. */
  reason: string | null;
}

/** `GET /owners/me`. */
export interface OwnerResponse {
  id: string;
  name: string | null;
  rootWallet: string | null;
  /** Absent from an API built before the switch existed; the web then reads reallocation as off. */
  reallocation?: ReallocationStatus;
  policy: OwnerPolicyView | null;
}

export interface ChainPermission {
  permissionId: string;
  installedNonce: number;
  installedBlock: string;
  uninstalled: boolean;
  live: boolean;
}

/** The indexer's read-model of an agent's account, up to its cursor. */
export interface ChainAccountView {
  account: string;
  deployment: { factory: string; paymaster: string; transactionHash: string; blockNumber: string } | null;
  limits: { perTxCap: string; dailyCap: string } | null;
  allowed: { target: string; selector: string }[];
  lastSpent: { amount: string; windowTotal: string; blockNumber: string } | null;
  totalSpent: string;
  invalidatedNonce: number | null;
  permissions: ChainPermission[];
}

/** The committed genome as the agent view serves it. Shown in plain language, never as raw parameters. */
export interface ApiGenome {
  strategyType: string;
  assetUniverse: string[];
  riskTolerance: number;
  executionFrequency: number;
  timeHorizon: number;
  entryThreshold: number;
  exitThreshold: number;
  informationSources: string[];
  informationBudget: string;
  modelConfiguration: string;
  hash: string;
  preset: string | null;
}

/** One preset of `GET /genome/presets`, with the hash of the genome it would commit for the configured pair. */
export interface GenomePresetView {
  name: string;
  riskTolerance: number;
  executionFrequency: number;
  timeHorizon: number;
  entryThreshold: number;
  exitThreshold: number;
  informationSources: string[];
  informationBudget: string;
  modelConfiguration: string;
  genomeHash: string;
}

export interface PresetsResponse {
  default: string;
  /** The trading pair every new agent's genome names, from the API's configuration. */
  pair: string;
  presets: GenomePresetView[];
}

/** `POST /agents` body. The genome is never sent: the server builds it from the preset. */
export interface CreateAgentInput {
  name: string;
  perTxCap: string;
  dailyCap: string;
  preset?: string;
}

export type SessionStatus = "active" | "revoking" | "revoked";

/**
 * One agent as the API serves it. The first group carries the field names of the sample `Agent`; every one of them
 * that no service produces yet is null or missing, and the screens show that absence rather than a value. They are
 * optional so the screens read an API built before a field existed the same way as one that returns it as null.
 */
export interface ApiAgent {
  id: string;
  name: string;
  ownerId: string;
  address: string | null;
  /** The worker's status: `active` or `retired`. */
  status: string | null;
  /** Owner deposits minus withdrawals, base units. 0 until funding is built, and an unfunded agent does not trade. */
  principal: string | null;
  /** Capital at the last evaluation, base units. */
  capital?: string | null;
  /** Filled trades since the agent was created. */
  tradeCount?: number | null;
  /** Adjusted fitness as a percentile within the agent's niche, 0 to 100. */
  fitnessPercentile?: number | null;
  /** Consecutive evaluations in the bottom of its niche (the starvation count). */
  lowWindows?: number | null;
  zeroDownsideFlag?: boolean | null;
  retirement?: { rule: string; evaluation: number } | null;
  genome: ApiGenome | null;
  /** Capital at each recorded evaluation, base units, oldest first. */
  capitalHistory?: { evaluation: number; capital: string }[] | null;
  x402?: X402Totals | null;

  owner: string;
  index: string;
  registryId: string | null;
  limits: { perTxCap: string; dailyCap: string };
  createdAt: number;
  deployment: "not-started" | "pending" | "deployed";
  session: { status: SessionStatus; keyAddress: string; issuedAt: number; revokedAt: number | null } | null;
  chain: ChainAccountView | null;
}

export interface AgentSpend {
  amount: string;
  windowTotal: string;
  transactionHash: string;
  blockNumber: string;
}

/** `GET /agents/:id`. */
export interface AgentDetailResponse {
  agent: ApiAgent;
  spends: AgentSpend[];
}

/** `GET /capital-flow`. While `reallocationsIndexed` is false, `reallocations` is empty because nothing indexes them. */
export interface CapitalFlowResponse {
  ownerId: string;
  reallocations: unknown[];
  reallocationsIndexed: boolean;
  spends: { agentId: string; amount: string; transactionHash: string; blockNumber: string }[];
}

/** EIP-712 typed data as the API relays it. Integers are decimal strings. */
export interface TypedDataPayload {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

/** An EIP-191 message: a UTF-8 string, or raw bytes as hex. */
export type MessagePayload = string | { raw: string };

export type SignatureRequest =
  | { id: string; expiresAt: number; kind: "message"; message: MessagePayload }
  | { id: string; expiresAt: number; kind: "typed-data"; typedData: TypedDataPayload };

export type OperationKind = "deploy" | "revoke" | "policy" | "activate";
export type OperationStatus = "awaiting-signature" | "running" | "succeeded" | "failed";

export interface Operation {
  id: string;
  kind: OperationKind;
  agentIds: string[];
  owner: string;
  status: OperationStatus;
  signatureRequest: SignatureRequest | null;
  result: unknown;
  error: string | null;
}

export interface HoldView {
  id: string;
  agentIds: string[];
  kind: string;
  requestedAt: number;
  confirmedAt: number | null;
  released: boolean;
}

export interface StopLocal {
  agentId: string;
  session: SessionStatus | null;
  revokedAt: number | null;
}

/** `POST /agents/:id/stop` and `POST /recovery/holds/:id/release`. */
export type StopResponse =
  | { status: "held"; hold: HoldView }
  | { status: "stopping" | "stopped" | "failed"; local: StopLocal[]; operation: Operation };

/** `GET /agents/:id/session`, and the `session` of a finished activation: read from chain and WalletsModule. */
export interface SessionView {
  status: SessionStatus;
  keyAddress: string;
  permissionId: string;
  issuedAt: number;
  /** The platform's vault holds the key, so the worker can sign with it. */
  keyHeld: boolean;
  state: { installed: boolean; validatorNonce: number; currentNonce: number; validNonceFrom: number };
  enableNonce: number;
  /** The account would accept an operation signed by this key now. */
  acceptedOnChain: boolean;
}

/** The `result` of a finished `activate` operation. */
export interface ActivateResult {
  result: { ok: true; keyAddress: string; permissionId: string; issued: boolean } | { ok: false; reason: string; detail?: string };
  session: SessionView | null;
}

/** `GET /agents/:id/revocation`: read from chain and WalletsModule; anyone can check the chain fields. */
export interface RevocationStatus {
  agentId: string;
  revoked: boolean;
  keyDestroyed: boolean;
  state: { installed: boolean; validatorNonce: number; currentNonce: number; validNonceFrom: number };
  enableNonce: number;
}
