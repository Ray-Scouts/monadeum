import { ACCOUNT_DEPLOYED, REALLOCATION_RECEIVED, REALLOCATION_SENT, SETTLEMENT_TRANSFER_IN, SETTLEMENT_TRANSFER_OUT } from "@monadeum/read-model";
import type { Address, Hex } from "viem";
import { HandlerRegistry } from "../registry.js";
import type { EventHandler, HandledEvent } from "../types.js";
import { entryPointEvents, kernelEvents, pickEvents, reallocationEvents, spendPolicyEvents, transferEvents } from "./abi.js";

const lower = (value: unknown): Address => String(value).toLowerCase() as Address;
const int = (value: unknown): string => BigInt(value as bigint).toString();

/**
 * `AgentSpendPolicy` (contracts/src/AgentSpendPolicy.sol). It discovers candidate accounts: WalletsModule deploys every
 * agent account and calls `setLimits` in the same owner-signed operation. A candidate is followed only if the
 * admission rule in `defaultRegistry` accepts it.
 */
export function spendPolicyHandler(address: Address): EventHandler {
  return {
    name: "agent-spend-policy",
    source: { kind: "contract", address: lower(address), discoversAccounts: true },
    events: spendPolicyEvents,
    kinds: ["spend.limits-set", "spend.call-allowed", "spend.spent", "spend.traded-asset-set"],
    handle({ eventName, args }): HandledEvent | null {
      const account = lower(args.account);
      switch (eventName) {
        case "LimitsSet":
          return { kind: "spend.limits-set", account, data: { perTxCap: int(args.perTxCap), dailyCap: int(args.dailyCap) } };
        case "CallAllowed":
          return {
            kind: "spend.call-allowed",
            account,
            data: { target: lower(args.target), selector: String(args.selector).toLowerCase(), allowed: Boolean(args.allowed) },
          };
        case "Spent":
          return { kind: "spend.spent", account, data: { amount: int(args.amount), windowTotal: int(args.windowTotal) } };
        case "TradedAssetSet":
          return { kind: "spend.traded-asset-set", account, data: { token: lower(args.token), traded: Boolean(args.traded) } };
        default:
          return null;
      }
    },
  };
}

/** EntryPoint v0.7 `AccountDeployed`, restricted to tracked accounts (topic 2 is `sender`). */
export function accountDeployedHandler(entryPoint: Address): EventHandler {
  return {
    name: "entry-point-account-deployed",
    source: { kind: "contract-by-account", address: lower(entryPoint), accountTopic: 2 },
    events: entryPointEvents,
    kinds: [ACCOUNT_DEPLOYED],
    handle({ args }) {
      return {
        kind: ACCOUNT_DEPLOYED,
        account: lower(args.sender),
        data: { userOpHash: String(args.userOpHash) as Hex, factory: lower(args.factory), paymaster: lower(args.paymaster) },
      };
    },
  };
}

/**
 * Kernel v3.1 events, emitted by the account itself, that WalletsModule's session key lifecycle produces: the
 * permission validator is installed on the key's first operation (`PermissionInstalled`), and revocation uninstalls it
 * (`PermissionUninstalled`) and calls `invalidateNonce` (`NonceInvalidated`). None of their parameters is indexed, so
 * the account is the log's emitting address.
 */
export function kernelSessionHandler(): EventHandler {
  return {
    name: "kernel-session-keys",
    source: { kind: "account" },
    events: kernelEvents,
    kinds: ["kernel.permission-installed", "kernel.permission-uninstalled", "kernel.nonce-invalidated"],
    handle({ eventName, args }, log): HandledEvent | null {
      const account = log.address;
      switch (eventName) {
        case "PermissionInstalled":
          return { kind: "kernel.permission-installed", account, data: { permissionId: String(args.permission).toLowerCase(), nonce: Number(args.nonce) } };
        case "PermissionUninstalled":
          return { kind: "kernel.permission-uninstalled", account, data: { permissionId: String(args.permission).toLowerCase() } };
        case "NonceInvalidated":
          return { kind: "kernel.nonce-invalidated", account, data: { nonce: Number(args.nonce) } };
        default:
          return null;
      }
    },
  };
}

/**
 * The settlement asset's ERC-20 `Transfer` events that touch a followed account, as two handlers on the one configured
 * contract: one filtered on `to` (topic 2), one on `from` (topic 1). A transfer between two followed accounts is stored
 * once per side, under different kinds. Only `asset`, the configured USDC address, is queried: a token at any other
 * address is never fetched, whatever its symbol (THREAT-MODEL.md invariant 16 and scenario H). The rows are facts
 * only; what counts as principal is decided by `principalFrom` in `@monadeum/read-model`.
 */
export function settlementTransferHandlers(asset: Address): [EventHandler, EventHandler] {
  const transfer = (direction: "in" | "out"): EventHandler => {
    const kind = direction === "in" ? SETTLEMENT_TRANSFER_IN : SETTLEMENT_TRANSFER_OUT;
    return {
      name: `settlement-transfer-${direction}`,
      source: { kind: "contract-by-account", address: lower(asset), accountTopic: direction === "in" ? 2 : 1 },
      events: transferEvents,
      kinds: [kind],
      handle({ args }) {
        const from = lower(args.from);
        const to = lower(args.to);
        return { kind, account: direction === "in" ? to : from, data: { from, to, value: int(args.value) } };
      },
    };
  };
  return [transfer("in"), transfer("out")];
}

/**
 * `AgentReallocation` (contracts/src/AgentReallocation.sol, ARCHITECTURE.md sections 9 and 16.5), as three handlers on
 * the one configured contract:
 *
 * - `Reallocated`, once per side, like the settlement transfers: `reallocation.sent` for a followed source (topic 2)
 *   and `reallocation.received` for a followed sink (topic 3). Reallocation never crosses owners, so a move between two
 *   of one owner's followed agents is stored twice, under the two kinds, with the same transaction and log index.
 * - The per-agent events, for followed accounts (topic 1): registration with its principal, a principal change, and
 *   retirement with who retired it.
 * - The owner-level and contract-level events, with no account: a committed or revoked policy, and each evaluation
 *   the operator advances. Operator and admin changes are not stored; nothing reads them from the read-model.
 *
 * The rows are facts. Nothing here decides what an agent may do; the contract's own state is authoritative.
 */
export function reallocationHandlers(address: Address): EventHandler[] {
  const contract = lower(address);
  const moved = (side: "sent" | "received"): EventHandler => {
    const kind = side === "sent" ? REALLOCATION_SENT : REALLOCATION_RECEIVED;
    return {
      name: `reallocation-${side}`,
      source: { kind: "contract-by-account", address: contract, accountTopic: side === "sent" ? 2 : 3 },
      events: pickEvents(reallocationEvents, ["Reallocated"]),
      kinds: [kind],
      handle({ args }) {
        const source = lower(args.source);
        const sink = lower(args.sink);
        return {
          kind,
          account: side === "sent" ? source : sink,
          data: { owner: lower(args.owner), source, sink, amount: int(args.amount), evaluation: int(args.evaluation) },
        };
      },
    };
  };
  const agents: EventHandler = {
    name: "reallocation-agents",
    source: { kind: "contract-by-account", address: contract, accountTopic: 1 },
    events: pickEvents(reallocationEvents, ["AgentRegistered", "PrincipalSet", "AgentRetired"]),
    kinds: ["reallocation.agent-registered", "reallocation.principal-set", "reallocation.agent-retired"],
    handle({ eventName, args }): HandledEvent | null {
      const account = lower(args.account);
      switch (eventName) {
        case "AgentRegistered":
          return { kind: "reallocation.agent-registered", account, data: { owner: lower(args.owner), principal: int(args.principal) } };
        case "PrincipalSet":
          return { kind: "reallocation.principal-set", account, data: { principal: int(args.principal) } };
        case "AgentRetired":
          return { kind: "reallocation.agent-retired", account, data: { owner: lower(args.owner), by: lower(args.by) } };
        default:
          return null;
      }
    },
  };
  const owners: EventHandler = {
    name: "reallocation-owners",
    source: { kind: "contract", address: contract },
    events: pickEvents(reallocationEvents, ["PolicyCommitted", "PolicyRevoked", "EvaluationAdvanced"]),
    kinds: ["reallocation.policy-committed", "reallocation.policy-revoked", "reallocation.evaluation-advanced"],
    handle({ eventName, args }): HandledEvent | null {
      switch (eventName) {
        case "PolicyCommitted":
          return { kind: "reallocation.policy-committed", account: null, data: { owner: lower(args.owner), policyHash: String(args.policyHash).toLowerCase(), nonce: int(args.nonce) } };
        case "PolicyRevoked":
          return { kind: "reallocation.policy-revoked", account: null, data: { owner: lower(args.owner), nonce: int(args.nonce) } };
        case "EvaluationAdvanced":
          return { kind: "reallocation.evaluation-advanced", account: null, data: { evaluation: int(args.evaluation) } };
        default:
          return null;
      }
    },
  };
  return [moved("sent"), moved("received"), agents, owners];
}

/**
 * The handlers for every contract that exists today. Further handlers are added with `registry.register`.
 *
 * Admission: an account is followed only if the transaction in which it first touches the spend policy also deployed
 * it through `kernelFactory`, which is how WalletsModule creates every agent account. This keeps arbitrary addresses
 * that call `setLimits` out of the followed set. It does not prove the platform created the account: anyone can
 * deploy a Kernel account through the same public factory and configure the policy in one operation, so the API still
 * joins the followed set against its own agent records (THREAT-MODEL.md boundary 10).
 */
export function defaultRegistry(input: {
  spendPolicy: Address;
  entryPoint: Address;
  kernelFactory: Address;
  settlementAsset: Address;
  /** The reallocation contract, when this read-model indexes it. */
  reallocation?: Address | null;
}): HandlerRegistry {
  const deployed = accountDeployedHandler(input.entryPoint);
  const factory = lower(input.kernelFactory);
  const [transferIn, transferOut] = settlementTransferHandlers(input.settlementAsset);
  const registry = new HandlerRegistry()
    .register(spendPolicyHandler(input.spendPolicy))
    .register(deployed)
    .register(kernelSessionHandler())
    .register(transferIn)
    .register(transferOut);
  for (const handler of input.reallocation ? reallocationHandlers(input.reallocation) : []) registry.register(handler);
  return registry.admitWith({ handler: deployed, admits: (row, log, seen) => row.data.factory === factory && log.transactionHash === seen.transactionHash });
}
