import { acceptQuote, type ValidQuote } from "@monadeum/external";

// Hardcoded for the MVP (SECURITY.md section 5). Adding a provider is a code change, never configuration.
export const PROVIDERS = ["nansen", "defillama"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Deployment configuration, set by the operator. Keyed by the fixed provider list; unknown keys are ignored. */
export interface ProviderEndpoint {
  baseUrl: string;
  payTo: string;
}

export interface PaymentTerms {
  asset: string;
  payTo: string;
  amount: bigint;
  network: string;
}

/** Signs the payment. Implemented by the wallet layer; this module never holds a key. */
export interface Payer {
  authorize(terms: PaymentTerms): Promise<string>;
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

export class X402Client {
  constructor(
    private readonly endpoints: Readonly<Record<Provider, ProviderEndpoint>>,
    private readonly settlementAsset: string,
    private readonly network: string,
    private readonly payer: Payer,
    private readonly log: PaymentLog,
    private readonly http: typeof fetch = fetch,
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
    const terms = parseTerms(await readJson(first), this.settlementAsset, endpoint.payTo, this.network);
    if (!terms || terms.amount > purchase.maxPrice) return { ok: false, reason: "terms" };

    const entry = (patch: Partial<PaymentLogEntry>): PaymentLogEntry => ({ ...base, price: terms.amount, anomaly: null, ...patch });
    // Logged before paying: a crash after payment leaves "unconfirmed-payment" for monitoring, never a second payment.
    await this.log.write(entry({ anomaly: "unconfirmed-payment" }));

    let authorization: string;
    try {
      authorization = await this.payer.authorize(terms);
    } catch {
      await this.log.write(entry({ price: 0n, anomaly: "authorize-failed" }));
      return { ok: false, reason: "anomaly" };
    }
    const paid = await this.fetch(url, { "x-payment": authorization });
    if (!paid || paid.status !== 200) {
      await this.log.write(entry({ anomaly: "paid-without-response" }));
      return { ok: false, reason: "anomaly" };
    }
    const settlementRef = paid.headers.get("x-payment-response");
    if (!settlementRef) {
      await this.log.write(entry({ anomaly: "no-settlement-reference" }));
      return { ok: false, reason: "anomaly" };
    }
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

// Assumption, re-verify against the x402 version in use: a 402 body lists `accepts`, each with scheme,
// network, maxAmountRequired (integer string), asset, and payTo. Descriptive fields are ignored on purpose
// (SECURITY.md section 6, tool poisoning): only typed fields are read.
function parseTerms(body: unknown, asset: string, payTo: string, network: string): PaymentTerms | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { accepts?: unknown }).accepts)) return null;
  for (const option of (body as { accepts: unknown[] }).accepts) {
    if (!option || typeof option !== "object") continue;
    const o = option as Record<string, unknown>;
    if (o.scheme !== "exact" || o.network !== network) continue;
    if (typeof o.asset !== "string" || o.asset.toLowerCase() !== asset.toLowerCase()) continue;
    if (typeof o.payTo !== "string" || o.payTo.toLowerCase() !== payTo.toLowerCase()) continue;
    if (typeof o.maxAmountRequired !== "string" || !/^\d{1,30}$/.test(o.maxAmountRequired)) continue;
    return { asset, payTo, amount: BigInt(o.maxAmountRequired), network };
  }
  return null;
}

/** In-memory log for tests and local development only. */
export class MemoryPaymentLog implements PaymentLog {
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
}
