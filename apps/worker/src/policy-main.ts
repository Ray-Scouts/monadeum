import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { hashRiskPolicy } from "@monadeum/commitment";
import { PgBreakerStore, PgPolicyVersions, loadDatabaseSettings, openDatabase, type Connect, type DatabaseHandle } from "@monadeum/db";
import { loadPolicy, type PolicyDocument } from "@monadeum/risk";
import { loadWalletsConfig } from "@monadeum/wallets";
import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { clearBreaker } from "./breaker.js";
import { loadWorkerTrading } from "./config.js";
import {
  PolicyError,
  appendVersion,
  buildPolicyDocument,
  latestVersion,
  policyFromJson,
  policyTarget,
  policyToJson,
  signWithKeystore,
  type PolicyAppender,
} from "./policy.js";

/**
 * The policy operator's CLI (ARCHITECTURE.md section 16.1; deploy/README.md, "Enable trading"). Four commands:
 *
 *   build  --per-action-cap <base units> --session-daily-cap <base units> --out <file>
 *          [--max-position-fraction <0..1>] [--effective-from <ISO 8601>]
 *     Builds the next version for this deployment from the WALLETS_* scope and the TRADING_* market, after verifying the
 *     stored chain (DATABASE_URL, WORKER_POLICY_SIGNER). Writes the unsigned document and prints the hash to sign.
 *   sign   --document <file> --keystore <file> --password-file <file> --out <file>
 *     Signs the document with an encrypted JSON keystore. The same signature comes from `cast wallet sign --account
 *     <name> <hash>`, which signs the 32-byte hash under EIP-191 as `loadPolicy` verifies it.
 *   append --document <file> (--signature <hex> | --signed <file>)
 *     Verifies the signature against WORKER_POLICY_SIGNER and the stored chain, then appends the version. DATABASE_URL
 *     must connect as a member of `monadeum_policy_operator`, the only role that may insert a version.
 *   show
 *     Lists the stored versions and the one in effect now, verified against WORKER_POLICY_SIGNER.
 *   breaker-show
 *     Prints the population breaker's state (SECURITY.md section 9, layer 3): the trip in force, or that none is.
 *   breaker-clear --by <who reviewed> --reason <why it is safe to resume>
 *     Releases a tripped breaker after a human review. Ticks and reallocation resume on the worker's next tick. Only
 *     `monadeum_policy_operator` may append a clear (migration 0018); the worker can trip the breaker, never clear it.
 *
 * Nothing here logs a key, a password, or a connection string. The operator key is never read from the environment.
 */

type Env = Record<string, string | undefined>;

export interface PolicyCliIo {
  log(message: string): void;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  connect?: Connect;
  now?: () => Date;
}

const OPTIONS = {
  "per-action-cap": { type: "string" },
  "session-daily-cap": { type: "string" },
  "max-position-fraction": { type: "string" },
  "effective-from": { type: "string" },
  out: { type: "string" },
  document: { type: "string" },
  keystore: { type: "string" },
  "password-file": { type: "string" },
  signature: { type: "string" },
  signed: { type: "string" },
  by: { type: "string" },
  reason: { type: "string" },
} as const;

function required(values: Record<string, unknown>, name: string): string {
  const v = values[name];
  if (typeof v !== "string" || v.trim() === "") throw new PolicyError(`--${name} is required`);
  return v.trim();
}

function units(values: Record<string, unknown>, name: string): bigint {
  const v = required(values, name);
  if (!/^\d+$/.test(v)) throw new PolicyError(`--${name} must be an integer number of settlement-asset base units`);
  return BigInt(v);
}

function pinnedSigner(env: Env): Address {
  const raw = env.WORKER_POLICY_SIGNER?.trim();
  if (!raw || !isAddress(raw)) throw new PolicyError("WORKER_POLICY_SIGNER must be set to the operator address that signs policy versions");
  return getAddress(raw);
}

async function open(env: Env, io: PolicyCliIo): Promise<DatabaseHandle | null> {
  return openDatabase(loadDatabaseSettings(env), { connect: io.connect, log: () => {} });
}

async function withStore<T>(env: Env, io: PolicyCliIo, run: (store: PolicyAppender) => Promise<T>): Promise<T> {
  const handle = await open(env, io);
  if (!handle) throw new PolicyError("DATABASE_URL is not set: there is no policy table to read or append to");
  try {
    return await run(new PgPolicyVersions(handle.db));
  } finally {
    await handle.close();
  }
}

export async function runPolicyCli(argv: readonly string[], env: Env, io: PolicyCliIo): Promise<void> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({ args: [...rest], options: OPTIONS, strict: true, allowPositionals: false });
  const now = io.now ?? (() => new Date());

  switch (command) {
    case "build": {
      const trading = loadWorkerTrading(env);
      if (!trading) throw new PolicyError("TRADING_KURU_MARKET is not set: a policy is built for the configured market");
      const { scope, target } = policyTarget(loadWalletsConfig(env), trading);
      const out = required(values, "out");
      const handle = await open(env, io);
      let previous = null;
      if (handle) {
        try {
          previous = await latestVersion(await new PgPolicyVersions(handle.db).list(), pinnedSigner(env));
        } finally {
          await handle.close();
        }
      } else {
        io.log("DATABASE_URL is not set: building version 1 without reading the stored versions");
      }
      const fraction = values["max-position-fraction"];
      const document = buildPolicyDocument({
        scope,
        target,
        perActionCap: units(values, "per-action-cap"),
        sessionDailyCap: units(values, "session-daily-cap"),
        maxPositionFraction: fraction === undefined ? undefined : Number(fraction),
        effectiveFrom: values["effective-from"] ?? now().toISOString(),
        previous,
      });
      await io.writeFile(out, `${policyToJson(document)}\n`);
      io.log(policyToJson(document));
      io.log(`wrote policy version ${document.version} to ${out}`);
      io.log(`hash to sign (EIP-191 over these 32 bytes): ${hashRiskPolicy(document)}`);
      return;
    }
    case "sign": {
      const document = policyFromJson(await io.readFile(required(values, "document")));
      const keystore = await io.readFile(required(values, "keystore"));
      const password = (await io.readFile(required(values, "password-file"))).replace(/\r?\n$/, "");
      const { signer, signature } = await signWithKeystore(document, keystore, password);
      const out = required(values, "out");
      await io.writeFile(out, `${JSON.stringify({ document: JSON.parse(policyToJson(document)), signer, signature }, null, 2)}\n`);
      io.log(`signed policy version ${document.version} (hash ${hashRiskPolicy(document)}) as ${signer}; wrote ${out}`);
      return;
    }
    case "append": {
      const pinned = pinnedSigner(env);
      let document: PolicyDocument;
      let signature: string;
      if (values.signed !== undefined) {
        const signed = JSON.parse(await io.readFile(values.signed)) as { document?: unknown; signature?: unknown };
        document = policyFromJson(signed.document);
        signature = String(signed.signature ?? "");
      } else {
        document = policyFromJson(await io.readFile(required(values, "document")));
        signature = required(values, "signature");
      }
      if (!isHex(signature)) throw new PolicyError("the signature must be hex");
      const verified = await withStore(env, io, (store) => appendVersion(store, document, signature as Hex, pinned));
      io.log(`appended policy version ${verified.document.version} (hash ${verified.hash}), effective from ${verified.document.effectiveFrom}`);
      return;
    }
    case "show": {
      const pinned = pinnedSigner(env);
      await withStore(env, io, async (store) => {
        const rows = await store.list();
        for (const { document } of rows) {
          io.log(`version ${document.version}: hash ${hashRiskPolicy(document)}, effective from ${document.effectiveFrom}, pairs ${document.allowedPairs.join(" ")}, per-action cap ${document.perActionCap}, session daily cap ${document.sessionDailyCap}`);
        }
        const active = await loadPolicy(rows, pinned, now());
        io.log(active ? `in effect now: version ${active.document.version}, verified against ${pinned}` : `no version signed by ${pinned} verifies and is in effect now: the worker skips every tick`);
      });
      return;
    }
    case "breaker-show":
    case "breaker-clear": {
      const handle = await open(env, io);
      if (!handle) throw new PolicyError("DATABASE_URL is not set: there is no breaker log to read or append to");
      try {
        const store = new PgBreakerStore(handle.db);
        if (command === "breaker-clear") {
          try {
            await clearBreaker(store, { actor: required(values, "by"), reason: required(values, "reason"), now: now() });
          } catch (error) {
            throw error instanceof PolicyError ? error : new PolicyError(error instanceof Error ? error.message : String(error));
          }
          io.log("population breaker cleared: ticks and reallocation resume on the worker's next tick");
          return;
        }
        const latest = await store.latest();
        io.log(latest?.kind === "trip"
          ? `population breaker TRIPPED at ${new Date(latest.recordedAt).toISOString()}: ${latest.reason}; no tick runs until it is cleared`
          : "population breaker not tripped");
      } finally {
        await handle.close();
      }
      return;
    }
    default:
      throw new PolicyError("usage: policy-main.js build | sign | append | show | breaker-show | breaker-clear (see apps/worker/src/policy-main.ts)");
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("policy-main.js")) {
  runPolicyCli(process.argv.slice(2), process.env, {
    log: (message) => console.log(message),
    readFile: (path) => readFile(path, "utf8"),
    writeFile: (path, content) => writeFile(path, content),
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
