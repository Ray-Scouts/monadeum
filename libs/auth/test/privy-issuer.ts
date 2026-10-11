import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

// A stand-in for Privy's token issuer, so tests run offline against the real `@privy-io/node` verification code.
// Claim names follow the installed SDK: `lib/auth.js` reads `aud`, `iss`, `iat`, `exp`, `sid`, `sub`, and
// `lib/identity-token.js` reads `sub`, `cr`, `guest`, and `linked_accounts`, a JSON string. The key is generated
// per run and never persisted.

export const APP_ID = "test-app-id";

const b64url = (value: object | Buffer) => (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))).toString("base64url");

export interface IdLinkedAccount {
  type: string;
  address?: string;
  chain_type?: string;
  wallet_client_type?: string;
  id?: string;
  lv?: number;
}

export class PrivyIssuer {
  readonly publicKeyPem: string;
  /** The public key as a JWKS member, carrying `kid` when the issuer has one, as Privy's published set does. */
  readonly publicJwk: Record<string, unknown>;
  private readonly privateKey: KeyObject;

  /** With a `kid`, every token header names it, so a verifier can select this key from a key set. */
  constructor(readonly kid?: string) {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    this.publicJwk = { ...publicKey.export({ format: "jwk" }), use: "sig", alg: "ES256", ...(kid ? { kid } : {}) };
    this.privateKey = privateKey;
  }

  jwt(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "ES256", typ: "JWT", ...(this.kid ? { kid: this.kid } : {}) }): string {
    const input = `${b64url(header)}.${b64url(payload)}`;
    const signature = sign("sha256", Buffer.from(input), { key: this.privateKey, dsaEncoding: "ieee-p1363" });
    return `${input}.${signature.toString("base64url")}`;
  }

  private base(sub: string, overrides: Record<string, unknown>) {
    const iat = Math.floor(Date.now() / 1000);
    return { iss: "privy.io", aud: APP_ID, sub, iat, exp: iat + 3600, ...overrides };
  }

  accessToken(sub: string, overrides: Record<string, unknown> = {}): string {
    return this.jwt({ sid: `session-${sub}`, ...this.base(sub, overrides) });
  }

  identityToken(sub: string, linked: IdLinkedAccount[], overrides: Record<string, unknown> = {}): string {
    const now = Math.floor(Date.now() / 1000);
    return this.jwt({ cr: String(now), guest: "f", linked_accounts: JSON.stringify(linked), ...this.base(sub, overrides) });
  }
}

export const embedded = (address: string): IdLinkedAccount => ({ type: "wallet", address, chain_type: "ethereum", wallet_client_type: "privy", id: "w1", lv: 1 });
