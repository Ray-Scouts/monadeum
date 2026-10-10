/** Makes a value JSON-safe: bigints become decimal strings, at any depth. Responses never carry a bigint. */
export function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}
