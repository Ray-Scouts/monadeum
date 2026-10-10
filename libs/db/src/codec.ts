// JSON encoding for record bodies stored in jsonb. Store records carry bigints (nonces, wei amounts, block numbers),
// which JSON cannot represent, and a JSON number would lose precision above 2^53. A bigint is written as
// {"$bigint": "<decimal>"} and read back as a bigint, so a record round-trips exactly. Bodies are read as text and
// parsed here, not by the driver, so `pg` and PGlite return identical values.

const TAG = "$bigint";

export function encode(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === "bigint") return { [TAG]: v.toString() };
    if (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && TAG in v) {
      throw new Error(`a record field named ${TAG} cannot be stored`);
    }
    return v;
  });
}

export function decode<T>(text: string): T {
  return JSON.parse(text, (_key, v: unknown) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === TAG) return BigInt((v as Record<string, string>)[TAG]!);
    }
    return v;
  }) as T;
}
