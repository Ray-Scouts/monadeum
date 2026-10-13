import { PgReadModelStore, loadDatabaseSettings, openDatabase } from "@monadeum/db";
import { loadIndexerConfig } from "../config.js";
import { defaultRegistry } from "../handlers/index.js";
import { crosscheck, type CrosscheckReport, type CrosscheckStore, type LogSource } from "./compare.js";
import { MONAD_TESTNET_HYPERSYNC_URL, HyperSyncLogSource, createHyperSyncClient } from "./hypersync.js";

export interface CrosscheckArgs {
  from: bigint;
  to: bigint;
  maxBlocks?: bigint;
}

/** Parses `--from <block> --to <block> [--max-blocks <n>]`. A bare `--` (from a package script) is ignored. */
export function parseArgs(argv: readonly string[]): CrosscheckArgs {
  const values = new Map<string, string>();
  const rest = argv.filter((a) => a !== "--");
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]!;
    const value = rest[i + 1];
    if (!["--from", "--to", "--max-blocks"].includes(flag) || value === undefined) throw new Error(`unexpected argument ${flag}`);
    if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer`);
    values.set(flag, value);
  }
  if (!values.has("--from") || !values.has("--to")) throw new Error("usage: crosscheck --from <block> --to <block> [--max-blocks <n>]");
  return { from: BigInt(values.get("--from")!), to: BigInt(values.get("--to")!), maxBlocks: values.has("--max-blocks") ? BigInt(values.get("--max-blocks")!) : undefined };
}

export interface CrosscheckRunOptions {
  env: Record<string, string | undefined>;
  args: CrosscheckArgs;
  /** Overrides, for tests. */
  source?: LogSource;
  store?: CrosscheckStore;
}

/**
 * Runs one cross-check from the environment: the indexer's own INDEXER_* settings (so the handlers are the same), the
 * read-model through DATABASE_URL, and HyperSync through ENVIO_API_TOKEN and optionally ENVIO_HYPERSYNC_URL. It never
 * writes the read-model; the store it uses is typed without a write method.
 */
export async function runCrosscheck(options: CrosscheckRunOptions): Promise<CrosscheckReport> {
  const { env, args } = options;
  const config = loadIndexerConfig(env);
  const registry = defaultRegistry({ spendPolicy: config.spendPolicy, entryPoint: config.entryPoint, kernelFactory: config.kernelFactory, settlementAsset: config.settlementAsset, reallocation: config.reallocation });
  const unverified = (reason: string): CrosscheckReport => ({
    status: "unverified",
    range: { from: Number(args.from), to: Number(args.to) },
    source: "envio-hypersync",
    reason,
    counts: { indexer: 0, source: 0 },
    matched: 0,
    missingInSource: [],
    missingInIndexer: [],
    fieldMismatches: [],
  });

  let source = options.source;
  const token = env.ENVIO_API_TOKEN?.trim();
  if (!source) {
    if (!token) return unverified("ENVIO_API_TOKEN is not set");
    const url = env.ENVIO_HYPERSYNC_URL?.trim() || MONAD_TESTNET_HYPERSYNC_URL;
    if (!/^https:\/\//.test(url)) return unverified("ENVIO_HYPERSYNC_URL must be an https URL");
    try {
      source = new HyperSyncLogSource(await createHyperSyncClient(url, token));
    } catch (error) {
      return unverified(redact(error, token));
    }
  }

  let database: Awaited<ReturnType<typeof openDatabase>> = null;
  try {
    let store = options.store;
    if (!store) {
      database = await openDatabase(loadDatabaseSettings(env), {});
      if (!database) return unverified("DATABASE_URL is not set, so there is no read-model to compare");
      store = new PgReadModelStore(database.db);
    }
    const report = await crosscheck({ source, store, registry, from: args.from, to: args.to, maxBlocks: args.maxBlocks });
    return report.reason ? { ...report, reason: redact(report.reason, token) } : report;
  } catch (error) {
    return unverified(redact(error, token));
  } finally {
    await database?.close();
  }
}

/** An error message with the token removed, so a client error that echoes its configuration cannot leak it. */
export function redact(error: unknown, token: string | undefined): string {
  const message = error instanceof Error ? error.message : String(error);
  return token ? message.split(token).join("[redacted]") : message;
}

/** Exit codes: 0 match, 1 mismatch (an alert), 2 unverified. */
export function exitCode(report: CrosscheckReport): number {
  return report.status === "match" ? 0 : report.status === "mismatch" ? 1 : 2;
}

async function main() {
  let args: CrosscheckArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const report = await runCrosscheck({ env: process.env, args });
  console.log(JSON.stringify(report, null, 2));
  process.exit(exitCode(report));
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("crosscheck/main.js")) {
  main().catch((error: unknown) => {
    console.error(redact(error, process.env.ENVIO_API_TOKEN?.trim()));
    process.exit(2);
  });
}
