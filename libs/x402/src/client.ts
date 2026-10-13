import { acceptQuote, type ValidQuote } from "@monadeum/external";

// Hardcoded for the MVP (SECURITY.md section 5). Adding a provider is a code change, never configuration.
export const PROVIDERS = ["nansen", "defillama"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Deployment configuration, set by the operator. Keyed by the fixed provider list; unknown keys are ignored. */
export interface ProviderEndpoint {
  baseUrl: string;
  payTo: string;
}

/**
 * The x402 v2 HTTP transport, FACT from the official specification (github.com/coinbase/x402,
 * `specs/transports-v2/http.md` and `specs/x402-specification-v2.md` at commit dd927a2, read 2026-10-10): the server
 * answers 402 with a `PAYMENT-REQUIRED` header holding base64 JSON `{ x402Version: 2, resource, accepts: [...] }`,
 * each requirement `{ scheme, network (CAIP-2, e.g. "eip155:143"), amount (atomic units, string), asset, payTo,
 * maxTimeoutSeconds, extra? }`; the client retries with a `PAYMENT-SIGNATURE` header holding base64 JSON
 * `{ x402Version: 2, resource?, accepted, payload }`; the server answers with a `PAYMENT-RESPONSE` header holding
 * base64 JSON `{ success, transaction, network, payer?, errorReason? }`. Version 1's `maxAmountRequired`, `X-PAYMENT`,
 * and `X-PAYMENT-RESPONSE` are not accepted: anything else fails closed. ASSUMPTION, not verified: the providers in
 * PROVIDERS serve v2 on Monad.
 */
export const X402_VERSION = 2;
export const PAYMENT_REQUIRED_HEADER = "payment-required";
export const PAYMENT_SIGNATURE_HEADER = "payment-signature";
export const PAYMENT_RESPONSE_HEADER = "payment-response";

/** One `accepts` entry the client chose, with its typed fields read and the entry kept as received. */
export interface PaymentTerms {
  scheme: "exact";
  /** CAIP-2, e.g. "eip155:143". */
  network: string;
  asset: string;
  payTo: string;
  amount: bigint;
  maxTimeoutSeconds: number;
  /** The requirement exactly as the server sent it, echoed back as `accepted`. */
  requirement: Record<string, unknown>;
  /** The resource object of the 402 response, echoed back as `resource`. */
  resource: Record<string, unknown> | null;
}

export interface Eip3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/** The v2 `PaymentPayload` for the `exact` scheme with EIP-3009. */
export interface PaymentPayload {
  x402Version: 2;
  resource?: Record<string, unknown>;
  accepted: Record<string, unknown>;
  payload: { signature: string; authorization: Eip3009Authorization };
}

/** Signs the payment. Implemented over the wallet layer (`ValidatorPayer`); this client never holds a key. */
export interface Payer {
  authorize(request: { key: string; tickKey: string; terms: PaymentTerms }): Promise<PaymentPayload>;
}

export interface PaymentLogEntry {
  key: string;
  provider: Provider;
  price: bigint;
  summary: string | null;
  settlementRef: string | null;
  anomaly: string | null;
  influencedDecision: boolean | null;
}

/**
 * Durable payment log. `claim` inserts only if the key is absent, atomically, and reports whether it did; `write`
 * replaces the entry under its key. A write must be durable before it resolves, because an entry is written before
 * the payment it records. `findBySettlement` returns the earliest-claimed entry with that settlement reference.
 * `@monadeum/db` provides the Postgres implementation.
 */
export interface PaymentLog {
  claim(entry: PaymentLogEntry): Promise<boolean>;
  write(entry: PaymentLogEntry): Promise<void>;
  get(key: string): Promise<PaymentLogEntry | undefined>;
  findBySettlement(ref: string): Promise<PaymentLogEntry | undefined>;
}

/**
 * x402 spend as the payment log records it, in settlement-asset base units. A purchase is counted, and its price added,
 * by the same rule as `X402Client.spent`: once its entry carries a nonzero price, that is, once payment was attempted
 * at accepted terms. An unconfirmed or anomalous payment therefore counts in full, so spend is never understated; a
 * purchase that never reached payment, or that the payer refused to sign, has price 0 and is not counted.
 */
export interface PaymentSpend {
  purchases: number;
  spent: bigint;
  /** Spend per provider as stored in the entry, sorted by provider; a provider with no counted purchase is absent. */
  byProvider: { provider: string; spent: bigint }[];
}

/** Read side of the payment log, for the API. The agent of an entry is `paymentAgentId(entry.key)`. */
export interface PaymentTotals {
  /** Spend of each agent in `agentIds`; an agent with no counted purchase maps to an empty tally. */
  spendByAgent(agentIds: readonly string[]): Promise<Map<string, PaymentSpend>>;
  /** Spend across every agent. */
  spendTotal(): Promise<PaymentSpend>;
  /** Entries that carry a settlement transaction reference: how many, and the latest `limit`, newest first. For the public evidence page. */
  settled(limit: number): Promise<{ count: number; entries: PaymentLogEntry[] }>;
}

/**
 * The agent a payment log entry belongs to. Every purchase key begins with the tick key, `<agentId>:<tick>:`, so the
 * agent ID is the key up to its first colon. This holds because agent IDs contain no colon (the API creates them under
 * `^[A-Za-z0-9_-]{1,64}$`); an ID with a colon would be misattributed.
 */
export function paymentAgentId(key: string): string {
  const i = key.indexOf(":");
  return i < 0 ? key : key.slice(0, i);
}

/** Tallies entries by the `PaymentSpend` rule. */
export function tallyPayments(entries: Iterable<PaymentLogEntry>): PaymentSpend {
  let purchases = 0;
  let spent = 0n;
  const byProvider = new Map<string, bigint>();
  for (const e of entries) {
    if (e.price <= 0n) continue;
    purchases += 1;
    spent += e.price;
    byProvider.set(e.provider, (byProvider.get(e.provider) ?? 0n) + e.price);
  }
  return { purchases, spent, byProvider: [...byProvider].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([provider, s]) => ({ provider, spent: s })) };
}

export interface Purchase {
  tickKey: string;
  provider: Provider;
  resource: string;
  maxPrice: bigint;
}

export type BuyResult =
  | { ok: true; quote: ValidQuote; price: bigint; paymentRef: string }
  | { ok: false; reason: "provider" | "unreachable" | "terms" | "already-paid" | "anomaly" | "malformed" };

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };
const MAX_BODY_CHARS = 64 * 1024;
const MAX_HEADER_CHARS = 16 * 1024;

export class X402Client {
  /**
   * `network` is the CAIP-2 chain identifier the payments must use, e.g. "eip155:143" for Monad mainnet or
   * "eip155:10143" for Monad testnet.
   */
  constructor(
    private readonly endpoints: Readonly<Record<Provider, ProviderEndpoint>>,
    private readonly settlementAsset: string,
    private readonly network: string,
    private readonly payer: Payer,
    private readonly log: PaymentLog,
    private readonly http: typeof fetch = fetch,
    /** The settlement asset's EIP-712 domain name and version, which the payer signs under. USDC: "USDC", "2". */
    private readonly assetDomain: { name: string; version: string } = { name: "USDC", version: "2" },
  ) {}

  async buy(purchase: Purchase): Promise<BuyResult> {
    const target = this.target(purchase);
    if (!target) return { ok: false, reason: "provider" };
    const { endpoint, url, key } = target;
    const base: PaymentLogEntry = {
      key, provider: purchase.provider, price: 0n, summary: null, settlementRef: null,
      anomaly: "not-paid", influencedDecision: null,
    };
    // Claimed atomically before any request, so two concurrent buys for the same key cannot both reach the payer.
    if (!(await this.log.claim(base))) return { ok: false, reason: "already-paid" };

    const first = await this.fetch(url, {});
    if (!first || first.status !== 402) return { ok: false, reason: "unreachable" };
    const terms = parsePaymentRequired(first.headers.get(PAYMENT_REQUIRED_HEADER), this.settlementAsset, endpoint.payTo, this.network, this.assetDomain);
    if (!terms || terms.amount > purchase.maxPrice) return { ok: false, reason: "terms" };

    const entry = (patch: Partial<PaymentLogEntry>): PaymentLogEntry => ({ ...base, price: terms.amount, anomaly: null, ...patch });
    // Logged before paying: a crash after payment leaves "unconfirmed-payment" for monitoring, never a second payment.
    await this.log.write(entry({ anomaly: "unconfirmed-payment" }));

    let payload: PaymentPayload;
    try {
      payload = await this.payer.authorize({ key, tickKey: purchase.tickKey, terms });
    } catch {
      await this.log.write(entry({ price: 0n, anomaly: "authorize-failed" }));
      return { ok: false, reason: "anomaly" };
    }
    if (!payloadMatches(payload, terms)) {
      // Signed but never sent. Counted in full anyway: a signed authorization is spendable by whoever holds it.
      await this.log.write(entry({ anomaly: "authorize-mismatch" }));
      return { ok: false, reason: "anomaly" };
    }
    const paid = await this.fetch(url, { [PAYMENT_SIGNATURE_HEADER]: encodeHeader(payload) });
    if (!paid || paid.status !== 200) {
      await this.log.write(entry({ anomaly: "paid-without-response" }));
      return { ok: false, reason: "anomaly" };
    }
    const settlement = parseSettlement(paid.headers.get(PAYMENT_RESPONSE_HEADER), this.network, payload.payload.authorization.from);
    if (!settlement.ok) {
      await this.log.write(entry({ anomaly: settlement.anomaly }));
      return { ok: false, reason: "anomaly" };
    }
    const settlementRef = settlement.transaction;
    if (await this.log.findBySettlement(settlementRef)) {
      await this.log.write(entry({ settlementRef, anomaly: "duplicate-grant" }));
      return { ok: false, reason: "anomaly" };
    }
    const accepted = acceptQuote(await readJson(paid));
    if (!accepted.ok || accepted.value.provider !== purchase.provider) {
      await this.log.write(entry({ settlementRef, anomaly: accepted.ok ? "provider-mismatch" : accepted.anomaly }));
      return { ok: false, reason: "malformed" };
    }
    const q = accepted.value;
    await this.log.write(entry({ settlementRef, summary: `${q.provider} price=${q.price} at ${q.observedAt}` }));
    return { ok: true, quote: q, price: terms.amount, paymentRef: key };
  }

  /**
   * What this purchase may have cost, from the payment log: the agreed price once payment was attempted, 0 when it
   * never was or the payer refused. An unconfirmed or anomalous payment counts in full, so costs are never understated.
   */
  async spent(purchase: Purchase): Promise<bigint> {
    const target = this.target(purchase);
    return target ? ((await this.log.get(target.key))?.price ?? 0n) : 0n;
  }

  private target(purchase: Purchase): { endpoint: ProviderEndpoint; url: URL; key: string } | null {
    if (!(PROVIDERS as readonly string[]).includes(purchase.provider)) return null;
    const endpoint = this.endpoints[purchase.provider];
    let url: URL;
    try {
      url = new URL(purchase.resource, endpoint.baseUrl);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.origin !== new URL(endpoint.baseUrl).origin) return null;
    // Idempotency is ours, never assumed from the provider or facilitator (SECURITY.md section 5).
    return { endpoint, url, key: `${purchase.tickKey}:${purchase.provider}:${url.pathname}${url.search}` };
  }

  /** Called after the strategy decides, so the log records whether the purchase changed the decision. */
  async recordInfluence(paymentRef: string, influenced: boolean): Promise<void> {
    const entry = await this.log.get(paymentRef);
    if (entry) await this.log.write({ ...entry, influencedDecision: influenced });
  }

  private async fetch(url: URL, headers: Record<string, string>): Promise<Response | null> {
    try {
      // A redirect would carry the payment header to an origin the check above never saw.
      return await this.http(url, { method: "GET", cache: "no-store", redirect: "error", headers: { ...NO_STORE, ...headers } });
    } catch {
      return null;
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    // Bounds what is parsed, not what is received: the body is still read in full before the length check.
    const text = await response.text();
    return text.length > MAX_BODY_CHARS ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/** Base64 JSON, as the v2 HTTP transport carries every x402 header. */
export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeHeader(value: string | null): unknown {
  if (!value || value.length > MAX_HEADER_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * Reads the `PAYMENT-REQUIRED` header and returns the one `exact` requirement on the configured network, asset, and
 * provider pay-to address. Descriptive fields are ignored on purpose (SECURITY.md section 6, tool poisoning): only the
 * typed fields are read. A requirement that names a transfer method other than EIP-3009, or a token domain other than
 * the configured one, is skipped, because the payer signs only EIP-3009 under that domain.
 */
export function parsePaymentRequired(
  header: string | null,
  asset: string,
  payTo: string,
  network: string,
  domain: { name: string; version: string } = { name: "USDC", version: "2" },
): PaymentTerms | null {
  const body = decodeHeader(header);
  if (!isObject(body) || body.x402Version !== X402_VERSION || !Array.isArray(body.accepts)) return null;
  const resource = isObject(body.resource) ? body.resource : null;
  for (const option of body.accepts) {
    if (!isObject(option)) continue;
    if (option.scheme !== "exact" || option.network !== network) continue;
    if (typeof option.asset !== "string" || option.asset.toLowerCase() !== asset.toLowerCase()) continue;
    if (typeof option.payTo !== "string" || option.payTo.toLowerCase() !== payTo.toLowerCase()) continue;
    if (typeof option.amount !== "string" || !/^[1-9]\d{0,29}$/.test(option.amount)) continue;
    if (typeof option.maxTimeoutSeconds !== "number" || !Number.isInteger(option.maxTimeoutSeconds) || option.maxTimeoutSeconds <= 0) continue;
    if (option.extra !== undefined) {
      if (!isObject(option.extra)) continue;
      const { assetTransferMethod, name, version } = option.extra;
      if (assetTransferMethod !== undefined && assetTransferMethod !== "eip3009") continue;
      if ((name !== undefined && name !== domain.name) || (version !== undefined && version !== domain.version)) continue;
    }
    return {
      scheme: "exact", network, asset, payTo, amount: BigInt(option.amount), maxTimeoutSeconds: option.maxTimeoutSeconds,
      requirement: option, resource,
    };
  }
  return null;
}

/** The payer's payload must echo the chosen requirement and authorize exactly its payee and amount. */
function payloadMatches(p: PaymentPayload, terms: PaymentTerms): boolean {
  if (!isObject(p) || p.x402Version !== X402_VERSION || !isObject(p.payload) || !isObject(p.payload.authorization)) return false;
  if (JSON.stringify(p.accepted) !== JSON.stringify(terms.requirement)) return false;
  const a = p.payload.authorization;
  return typeof a.to === "string" && a.to.toLowerCase() === terms.payTo.toLowerCase() && a.value === terms.amount.toString() &&
    typeof a.from === "string" && typeof p.payload.signature === "string";
}

/** Reads the `PAYMENT-RESPONSE` header: a successful settlement on the configured network, by this payer. */
export function parseSettlement(header: string | null, network: string, payer: string):
  | { ok: true; transaction: string }
  | { ok: false; anomaly: "no-settlement-reference" | "settlement-failed" | "settlement-mismatch" } {
  const body = decodeHeader(header);
  if (!isObject(body)) return { ok: false, anomaly: "no-settlement-reference" };
  if (body.success !== true) return { ok: false, anomaly: "settlement-failed" };
  if (typeof body.transaction !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.transaction)) return { ok: false, anomaly: "no-settlement-reference" };
  if (body.network !== network) return { ok: false, anomaly: "settlement-mismatch" };
  if (body.payer !== undefined && (typeof body.payer !== "string" || body.payer.toLowerCase() !== payer.toLowerCase())) {
    return { ok: false, anomaly: "settlement-mismatch" };
  }
  return { ok: true, transaction: body.transaction.toLowerCase() };
}

/** In-memory log for tests and local development only. */
export class MemoryPaymentLog implements PaymentLog, PaymentTotals {
  private readonly rows = new Map<string, PaymentLogEntry>();
  async claim(entry: PaymentLogEntry): Promise<boolean> {
    if (this.rows.has(entry.key)) return false;
    this.rows.set(entry.key, entry);
    return true;
  }
  async write(entry: PaymentLogEntry): Promise<void> {
    this.rows.set(entry.key, entry);
  }
  async get(key: string): Promise<PaymentLogEntry | undefined> {
    return this.rows.get(key);
  }
  async findBySettlement(ref: string): Promise<PaymentLogEntry | undefined> {
    return [...this.rows.values()].find((r) => r.settlementRef === ref);
  }
  async spendByAgent(agentIds: readonly string[]): Promise<Map<string, PaymentSpend>> {
    const entries = [...this.rows.values()];
    return new Map(agentIds.map((id) => [id, tallyPayments(entries.filter((e) => paymentAgentId(e.key) === id))]));
  }
  async spendTotal(): Promise<PaymentSpend> {
    return tallyPayments(this.rows.values());
  }
  async settled(limit: number): Promise<{ count: number; entries: PaymentLogEntry[] }> {
    const all = [...this.rows.values()].filter((e) => e.settlementRef !== null);
    return { count: all.length, entries: all.reverse().slice(0, limit) };
  }
}
