import {
  HyperSyncLogSource,
  MONAD_TESTNET_HYPERSYNC_URL,
  createHyperSyncClient,
  crosscheck,
  defaultRegistry,
  loadIndexerConfig,
  type CrosscheckReport,
  type LogSource,
  type ReadModelStore,
} from "@monadeum/indexer";

// The Envio HyperSync cross-check on the public evidence endpoint (ARCHITECTURE.md section 10, "How Envio is used on
// the public evidence page"). The comparison is the indexer's own `crosscheck`; this module decides when it runs, how
// often, and what of the result is public. It never runs on the request path.

export const CROSSCHECK_SOURCE = "envio-hypersync";

/** Why a result is `unverified`. Short stable codes, never the text of an error, which could name a URL or a token. */
export type CrossCheckReason = "pending" | "stale" | "lagging" | "no-cursor" | "range" | "too-large" | "timeout" | "unavailable";

/** The `crossCheck` field of the evidence document. It holds counts and a range only: no row, address, hash, or amount. */
export interface CrossCheckBlock {
  source: typeof CROSSCHECK_SOURCE;
  status: "match" | "mismatch" | "unverified";
  /** Present only when `status` is `unverified`. */
  reason?: CrossCheckReason;
  /** The compared block range, inclusive, or null before any run finished. Block numbers are decimal strings. */
  range: { from: string; to: string } | null;
  /** Rows the indexer stored and rows HyperSync returned, in the range. */
  counts: { indexer: number; hypersync: number };
  matched: number;
  missing: { inHyperSync: number; inIndexer: number };
  fieldMismatches: number;
  /** The highest block HyperSync reported when it was read, or null. */
  hypersyncHeight: string | null;
  /** When the comparison finished, ISO 8601; null before any run finished. It is not part of the comparison. */
  checkedAt: string | null;
}

export interface CrossCheckSettings {
  /** After this a cached result starts one background refresh. Default 60 seconds. */
  freshMs: number;
  /** After this a cached result is served as `unverified` with reason `stale`. Default 10 minutes. */
  maxStaleMs: number;
  /** Most refreshes the process starts in any 60 seconds, whoever asks. Default 2. */
  maxRunsPerMinute: number;
  /** A refresh that has not finished by then is recorded as `unverified` with reason `timeout`. Default 30 seconds. */
  runTimeoutMs: number;
}

/** Proposed, not measured. */
export const DEFAULT_CROSSCHECK_SETTINGS: CrossCheckSettings = { freshMs: 60_000, maxStaleMs: 600_000, maxRunsPerMinute: 2, runTimeoutMs: 30_000 };
export const DEFAULT_CROSSCHECK_WINDOW_BLOCKS = 50_000;
export const MAX_CROSSCHECK_WINDOW_BLOCKS = 100_000;

/** The kinds the evidence endpoint serves from indexed logs: account deployments, spend policy events, reallocation events. */
export const isEvidenceKind = (kind: string): boolean => kind === "account.deployed" || kind.startsWith("spend.") || kind.startsWith("reallocation.");

/** Runs one comparison over the current window. It must not throw; if it does, the failure is `unavailable`. */
export type CrossCheckRunner = () => Promise<CrosscheckReport>;

interface Cached {
  block: CrossCheckBlock;
  at: number;
}

const PENDING: CrossCheckBlock = {
  source: CROSSCHECK_SOURCE,
  status: "unverified",
  reason: "pending",
  range: null,
  counts: { indexer: 0, hypersync: 0 },
  matched: 0,
  missing: { inHyperSync: 0, inIndexer: 0 },
  fieldMismatches: 0,
  hypersyncHeight: null,
  checkedAt: null,
};

/** Maps the text of a report's reason to a code. Anything unrecognized is `unavailable`, so error text never leaves the process. */
export function reasonCode(reason: string | undefined): CrossCheckReason {
  if (!reason) return "unavailable";
  if (/has indexed up to block|above the stored cursor/.test(reason)) return "lagging";
  if (/no cursor/.test(reason)) return "no-cursor";
  if (/range is|wider than|safe integer/.test(reason)) return "range";
  if (/more than \d+ (logs|rows)|did not finish within|holds more than/.test(reason)) return "too-large";
  if (/timed out/.test(reason)) return "timeout";
  return "unavailable";
}

/** The public form of a report. The comparison carries no time; `checkedAt` is added here, outside it. */
export function blockOf(report: CrosscheckReport, checkedAt: number): CrossCheckBlock {
  const unverified = report.status === "unverified";
  return {
    source: CROSSCHECK_SOURCE,
    status: report.status,
    ...(unverified ? { reason: reasonCode(report.reason) } : {}),
    range: { from: String(report.range.from), to: String(report.range.to) },
    counts: { indexer: report.counts.indexer, hypersync: report.counts.source },
    matched: report.matched,
    missing: { inHyperSync: report.missingInSource.length, inIndexer: report.missingInIndexer.length },
    fieldMismatches: report.fieldMismatches.length,
    hypersyncHeight: report.sourceHeight === undefined ? null : String(report.sourceHeight),
    checkedAt: new Date(checkedAt).toISOString(),
  };
}

const failed = (reason: "timeout" | "unavailable", at: number): CrossCheckBlock => ({ ...PENDING, reason, checkedAt: new Date(at).toISOString() });

/**
 * One cache for the whole process, shared by every caller. `snapshot()` answers from memory at once and, when the cache
 * is older than `freshMs`, starts at most one background refresh (single flight), and only while fewer than
 * `maxRunsPerMinute` refreshes started in the last minute. A public caller therefore cannot cause more HyperSync work
 * than that bound, however often it asks. The previous result is served while a refresh runs (stale-while-revalidate),
 * and one older than `maxStaleMs` is served as `unverified`, never as `match`.
 */
export class EvidenceCrossCheck {
  private cached: Cached | null = null;
  private running = false;
  private readonly starts: number[] = [];
  private readonly settings: CrossCheckSettings;

  constructor(
    private readonly run: CrossCheckRunner,
    private readonly now: () => number = Date.now,
    settings: Partial<CrossCheckSettings> = {},
  ) {
    this.settings = { ...DEFAULT_CROSSCHECK_SETTINGS, ...settings };
  }

  snapshot(): CrossCheckBlock {
    const now = this.now();
    this.refreshIfDue(now);
    const cached = this.cached;
    if (!cached) return PENDING;
    if (now - cached.at > this.settings.maxStaleMs) return { ...cached.block, status: "unverified", reason: "stale" };
    return cached.block;
  }

  /** Resolves when the refresh in flight, if any, has finished. For tests and shutdown; requests never wait on it. */
  async settled(): Promise<void> {
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 1));
  }

  private refreshIfDue(now: number): void {
    if (this.running) return;
    if (this.cached && now - this.cached.at < this.settings.freshMs) return;
    while (this.starts.length > 0 && now - this.starts[0]! >= 60_000) this.starts.shift();
    if (this.starts.length >= this.settings.maxRunsPerMinute) return;
    this.starts.push(now);
    this.running = true;
    this.refresh();
  }

  /**
   * The slot stays taken until the run itself settles, even after the deadline recorded a `timeout`, so a source that
   * hangs cannot pile up runs: nothing new starts while one is outstanding.
   */
  private refresh(): void {
    let recorded = false;
    const record = (block: () => CrossCheckBlock) => {
      if (recorded) return;
      recorded = true;
      this.cached = { block: block(), at: this.now() };
    };
    const timer = setTimeout(() => record(() => failed("timeout", this.now())), this.settings.runTimeoutMs);
    timer.unref?.();
    Promise.resolve().then(() => this.run()).then(
      (report) => record(() => blockOf(report, this.now())),
      () => record(() => failed("unavailable", this.now())),
    ).finally(() => {
      clearTimeout(timer);
      this.running = false;
    });
  }
}

type Env = Record<string, string | undefined>;

export interface CrossCheckRuntimeOptions {
  /** Overrides the HyperSync source, for tests. With it, no token is needed. */
  source?: LogSource;
  settings?: Partial<CrossCheckSettings>;
  now?: () => number;
  log?: (message: string) => void;
}

function windowBlocks(env: Env): number {
  const raw = env.API_CROSSCHECK_WINDOW_BLOCKS?.trim();
  if (!raw) return DEFAULT_CROSSCHECK_WINDOW_BLOCKS;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > MAX_CROSSCHECK_WINDOW_BLOCKS) {
    throw new Error(`API_CROSSCHECK_WINDOW_BLOCKS must be an integer from 1 to ${MAX_CROSSCHECK_WINDOW_BLOCKS}`);
  }
  return Number(raw);
}

function runsPerMinute(env: Env): number | undefined {
  const raw = env.API_CROSSCHECK_MAX_RUNS_PER_MINUTE?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 10) throw new Error("API_CROSSCHECK_MAX_RUNS_PER_MINUTE must be an integer from 1 to 10");
  return Number(raw);
}

/** An error message with the token removed, so a client error that echoes its configuration cannot leak it. */
export function withoutToken(error: unknown, token: string | undefined): string {
  const message = error instanceof Error ? error.message : String(error);
  return token ? message.split(token).join("[redacted]") : message;
}

/**
 * Builds the cross-check from the environment, or returns null when it is off. It is off unless `ENVIO_API_TOKEN` is
 * set (no token, no client, no call to Envio). It reads the indexer's own `INDEXER_*` settings so the handlers are the
 * same, and a configuration it cannot read leaves it off with a log line that never contains the token.
 */
export function loadEvidenceCrossCheck(env: Env, readModel: ReadModelStore, options: CrossCheckRuntimeOptions = {}): EvidenceCrossCheck | null {
  const token = env.ENVIO_API_TOKEN?.trim();
  if (!token && !options.source) return null;
  try {
    const config = loadIndexerConfig(env);
    const registry = defaultRegistry({ spendPolicy: config.spendPolicy, entryPoint: config.entryPoint, kernelFactory: config.kernelFactory, settlementAsset: config.settlementAsset, reallocation: config.reallocation });
    const window = BigInt(windowBlocks(env));
    const url = env.ENVIO_HYPERSYNC_URL?.trim() || MONAD_TESTNET_HYPERSYNC_URL;
    if (!options.source && !/^https:\/\//.test(url)) throw new Error("ENVIO_HYPERSYNC_URL must be an https URL");
    // The native client is loaded at the first run, once, and not at all while the cross-check is off.
    let source: Promise<LogSource> | null = null;
    const sourceOf = (): Promise<LogSource> => (source ??= options.source ? Promise.resolve(options.source) : createHyperSyncClient(url, token!).then((client) => new HyperSyncLogSource(client)));
    const run: CrossCheckRunner = async () => {
      const cursor = await readModel.cursor();
      const empty = (reason: string): CrosscheckReport => ({ status: "unverified", range: { from: 0, to: 0 }, source: CROSSCHECK_SOURCE, reason, counts: { indexer: 0, source: 0 }, matched: 0, missingInSource: [], missingInIndexer: [], fieldMismatches: [] });
      if (!cursor) return empty("the read-model has no cursor yet");
      const to = cursor.number;
      const from = to + 1n - window > config.sync.startBlock ? to + 1n - window : config.sync.startBlock;
      try {
        return await crosscheck({ source: await sourceOf(), store: readModel, registry, from, to, maxBlocks: window, kinds: isEvidenceKind });
      } catch (error) {
        source = null;
        options.log?.(`evidence cross-check failed: ${withoutToken(error, token)}`);
        return { ...empty("unavailable"), range: { from: Number(from), to: Number(to) } };
      }
    };
    return new EvidenceCrossCheck(run, options.now, { ...options.settings, ...(runsPerMinute(env) === undefined ? {} : { maxRunsPerMinute: runsPerMinute(env)! }) });
  } catch (error) {
    options.log?.(`evidence cross-check is off: ${withoutToken(error, token)}`);
    return null;
  }
}
