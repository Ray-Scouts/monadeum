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
}

export interface OwnerPolicyView {
  agentIds: string[];
  reallocationCap: number | null;
  slotCeiling: number | null;
  signedAtEvaluation: null;
  sequence: number;
  policyHash: string;
}

/** `GET /owners/me`. */
export interface OwnerResponse {
  id: string;
  name: string | null;
  rootWallet: string | null;
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

export type SessionStatus = "active" | "revoking" | "revoked";

/**
 * One agent as the API serves it. The first group carries the field names of the sample `Agent`; every one of them
 * that no service produces yet is null, and the screens show that absence rather than a value.
 */
export interface ApiAgent {
  id: string;
  name: string;
  ownerId: string;
  address: string | null;
  status: string | null;
  principal: string | number | null;
  capital: string | number | null;
  tradeCount: number | null;
  fitnessPercentile: number | null;
  lowWindows: number | null;
  zeroDownsideFlag: boolean | null;
  retirement: { rule: string; evaluation: number } | null;
  genome: unknown;
  capitalHistory: unknown;

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

export type OperationKind = "deploy" | "revoke" | "policy";
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

/** `GET /agents/:id/revocation`: read from chain and WalletsModule; anyone can check the chain fields. */
export interface RevocationStatus {
  agentId: string;
  revoked: boolean;
  keyDestroyed: boolean;
  state: { installed: boolean; validatorNonce: number; currentNonce: number; validNonceFrom: number };
  enableNonce: number;
}
