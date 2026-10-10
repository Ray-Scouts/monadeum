import { concat, keccak256, stringToBytes, type Hex } from "viem";

// ARCHITECTURE.md section 16.4: hash = keccak256(utf8(tag) || 0x00 || utf8(JCS(normalize(value))))

export type CommitmentTag =
  | "monadeum:genome:v1"
  | "monadeum:strategy:v1"
  | "monadeum:policy:v1"
  | "monadeum:plan:v1";

export class CanonicalizationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "CanonicalizationError";
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function serializeString(value: string, path: string): string {
  // RFC 8785 requires I-JSON input (RFC 7493), which forbids unpaired surrogates
  if (LONE_SURROGATE.test(value)) throw new CanonicalizationError(path, "string contains an unpaired UTF-16 surrogate");
  return JSON.stringify(value);
}

function serialize(value: unknown, path: string): string {
  if (value === null) throw new CanonicalizationError(path, "null is not allowed; omit an absent field instead");
  switch (typeof value) {
    case "string":
      return serializeString(value, path);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalizationError(path, "number must be finite");
      // ECMAScript Number serialization is the RFC 8785 number format; it also writes -0 as 0
      return JSON.stringify(value);
    case "bigint":
      // Base-unit amounts cross every boundary as decimal strings (ARCHITECTURE.md section 16)
      return JSON.stringify(value.toString());
    case "object":
      break;
    default:
      throw new CanonicalizationError(path, `unsupported type ${typeof value}`);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!(i in value) || value[i] === undefined) throw new CanonicalizationError(`${path}[${i}]`, "array element is missing or undefined");
      items.push(serialize(value[i], `${path}[${i}]`));
    }
    return `[${items.join(",")}]`;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new CanonicalizationError(path, "only plain objects can be canonicalized");
  // Default sort compares UTF-16 code units, the RFC 8785 key order; undefined values are absent fields
  const keys = Object.keys(value)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  const members = keys.map((k) => `${serializeString(k, `${path}.${k}`)}:${serialize((value as Record<string, unknown>)[k], `${path}.${k}`)}`);
  return `{${members.join(",")}}`;
}

/** RFC 8785 (JCS) serialization of an already normalized value, with the strict input rules of section 16.4. */
export function canonicalJson(value: unknown): string {
  return serialize(value, "$");
}

/** Domain-tagged keccak256 over the canonical JSON of an already normalized value. */
export function taggedHash(tag: CommitmentTag, value: unknown): Hex {
  return keccak256(concat([stringToBytes(tag), new Uint8Array([0]), stringToBytes(canonicalJson(value))]));
}

/** Set-valued fields: deduplicate, then sort in UTF-16 code unit order (section 16.4, normalization rule 1). */
export function canonicalSet(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
