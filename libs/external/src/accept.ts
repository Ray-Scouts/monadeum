export type Accepted<T> = { ok: true; value: T } | { ok: false; anomaly: string };

export interface ValidQuote {
  provider: "nansen" | "defillama";
  price: number;
  observedAt: string;
}

const TOKEN_FIELD = /^[A-Za-z0-9.$-]{1,32}$/;

function reject(anomaly: string): Accepted<never> {
  return { ok: false, anomaly };
}

export function acceptQuote(payload: unknown): Accepted<ValidQuote> {
  if (payload === null || typeof payload !== "object") return reject("quote shape");
  const body = payload as Record<string, unknown>;
  if (body.provider !== "nansen" && body.provider !== "defillama") return reject("provider");
  if (typeof body.price !== "number" || !Number.isFinite(body.price) || body.price < 0) return reject("price");
  if (typeof body.observedAt !== "string" || body.observedAt.length === 0) return reject("observedAt");
  return { ok: true, value: { provider: body.provider, price: body.price, observedAt: body.observedAt } };
}

export function acceptTokenField(value: unknown): Accepted<string> {
  if (typeof value !== "string" || !TOKEN_FIELD.test(value)) return reject("token field");
  return { ok: true, value };
}
