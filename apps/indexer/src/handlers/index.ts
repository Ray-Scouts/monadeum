import type { Address, Hex } from "viem";
import { HandlerRegistry } from "../registry.js";
import type { EventHandler, HandledEvent } from "../types.js";
import { entryPointEvents, kernelEvents, spendPolicyEvents } from "./abi.js";

const lower = (value: unknown): Address => String(value).toLowerCase() as Address;
const int = (value: unknown): string => BigInt(value as bigint).toString();

/**
 * `AgentSpendPolicy` (contracts/src/AgentSpendPolicy.sol). It discovers accounts: WalletsModule deploys every agent
 * account and calls `setLimits` in the same owner-signed operation, so an account that has set limits here is an
 * account to follow. Anyone can call `setLimits` from any address, so presence in this set is a chain fact, not
 * proof that the platform created the account; the API joins against its own agent records (THREAT-MODEL.md
 * boundary 10).
 */
export function spendPolicyHandler(address: Address): EventHandler {
  return {
    name: "agent-spend-policy",
    source: { kind: "contract", address: lower(address), discoversAccounts: true },
    events: spendPolicyEvents,
    kinds: ["spend.limits-set", "spend.call-allowed", "spend.spent"],
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
    kinds: ["account.deployed"],
    handle({ args }) {
      return {
        kind: "account.deployed",
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

/** The handlers for every contract that exists today. Further handlers are added with `registry.register`. */
export function defaultRegistry(input: { spendPolicy: Address; entryPoint: Address }): HandlerRegistry {
  return new HandlerRegistry()
    .register(spendPolicyHandler(input.spendPolicy))
    .register(accountDeployedHandler(input.entryPoint))
    .register(kernelSessionHandler());
}
