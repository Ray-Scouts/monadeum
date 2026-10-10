import type { Address, Hex } from "viem";

/** How the platform verified that a wallet belongs to the user. */
export type WalletProof = "privy-identity-token" | "wallet-signature";

export interface LinkedWallet {
  address: Address;
  /** `embedded`: a Privy embedded wallet. `external`: a wallet the user brought, the advanced path. */
  kind: "embedded" | "external";
  proof: WalletProof;
  linkedAt: number;
}

/**
 * One user, however they arrived. A Privy identity and any number of wallets link to the same record; none of
 * them is ever represented as a second user.
 */
export interface UserRecord {
  id: string;
  /** Privy user ID (`did:privy:...`), or null for a user who has only signed in with an external wallet. */
  privyUserId: string | null;
  /**
   * The root wallet: the owner of every agent account this user creates (ARCHITECTURE.md section 6). Set once,
   * from the first wallet the platform verifies for the user, and never changed by linking another wallet.
   */
  ownerWallet: Address | null;
  wallets: LinkedWallet[];
  createdAt: number;
}

/**
 * Durable user store. Uniqueness is the store's job, because it is what keeps one person from becoming two
 * accounts: a Privy user ID and a wallet address (compared case-insensitively) each belong to at most one user.
 * `create` and `update` return false, and change nothing, when the record would take a Privy ID or a wallet that
 * another user holds, when the record lists a wallet twice, when `create` finds the ID taken, when `update` finds
 * no such user, or when `update` would change an owner wallet that is already set. `@monadeum/db` provides the
 * Postgres implementation, which enforces these with unique constraints and one transaction per write.
 */
export interface UserStore {
  get(id: string): Promise<UserRecord | undefined>;
  byPrivyUserId(privyUserId: string): Promise<UserRecord | undefined>;
  byWallet(address: Address): Promise<UserRecord | undefined>;
  create(record: UserRecord): Promise<boolean>;
  update(record: UserRecord): Promise<boolean>;
}

export interface WalletChallenge {
  nonce: string;
  /** The exact EIP-4361 message the wallet must sign. The server keeps it, so the client cannot alter it. */
  message: string;
  address: Address;
  /** `sign-in` authenticates as the wallet's user; `link` adds the wallet to `userId`, an authenticated user. */
  purpose: "sign-in" | "link";
  userId: string | null;
  expiresAt: number;
}

/** One-time challenges. `put` throws when the nonce was already issued. `consume` returns a challenge at most once, then forgets it. */
export interface ChallengeStore {
  put(challenge: WalletChallenge): Promise<void>;
  consume(nonce: string): Promise<WalletChallenge | undefined>;
}

export interface WalletSession {
  /** SHA-256 of the bearer token. The token itself is never stored. */
  tokenHash: Hex;
  userId: string;
  wallet: Address;
  expiresAt: number;
}

/**
 * Platform sessions for the external wallet path. The Privy path uses Privy's own access token instead. `put`
 * replaces a session with the same hash, and throws when `tokenHash` is not a lowercase 32-byte hex digest, so a
 * plaintext token can never be stored by mistake.
 */
export interface SessionStore {
  put(session: WalletSession): Promise<void>;
  get(tokenHash: Hex): Promise<WalletSession | undefined>;
  delete(tokenHash: Hex): Promise<void>;
}

const lower = (a: string) => a.toLowerCase();
const TOKEN_HASH = /^0x[0-9a-f]{64}$/;

/** True when `next` would change an owner wallet that `current` already set. */
function changesOwnerWallet(current: UserRecord, next: UserRecord): boolean {
  return current.ownerWallet !== null && (next.ownerWallet === null || lower(next.ownerWallet) !== lower(current.ownerWallet));
}
const copy = (r: UserRecord): UserRecord => ({ ...r, wallets: r.wallets.map((w) => ({ ...w })) });

/** In-memory store for tests and local development only. */
export class MemoryUserStore implements UserStore {
  private readonly users = new Map<string, UserRecord>();

  async get(id: string) {
    const r = this.users.get(id);
    return r ? copy(r) : undefined;
  }

  async byPrivyUserId(privyUserId: string) {
    for (const r of this.users.values()) if (r.privyUserId === privyUserId) return copy(r);
    return undefined;
  }

  async byWallet(address: Address) {
    for (const r of this.users.values()) if (r.wallets.some((w) => lower(w.address) === lower(address))) return copy(r);
    return undefined;
  }

  async create(record: UserRecord) {
    if (this.users.has(record.id) || this.collides(record)) return false;
    this.users.set(record.id, copy(record));
    return true;
  }

  async update(record: UserRecord) {
    const current = this.users.get(record.id);
    if (!current || changesOwnerWallet(current, record) || this.collides(record)) return false;
    this.users.set(record.id, copy(record));
    return true;
  }

  /** True when another user already holds the record's Privy ID or one of its wallets, or the record repeats a wallet. */
  private collides(record: UserRecord): boolean {
    const mine = new Set(record.wallets.map((w) => lower(w.address)));
    if (mine.size !== record.wallets.length) return true;
    for (const other of this.users.values()) {
      if (other.id === record.id) continue;
      if (record.privyUserId !== null && other.privyUserId === record.privyUserId) return true;
      if (other.wallets.some((w) => mine.has(lower(w.address)))) return true;
    }
    return false;
  }
}

/** In-memory challenge store for tests and local development only. */
export class MemoryChallengeStore implements ChallengeStore {
  private readonly challenges = new Map<string, WalletChallenge>();
  async put(challenge: WalletChallenge) {
    if (this.challenges.has(challenge.nonce)) throw new Error("nonce reused");
    this.challenges.set(challenge.nonce, { ...challenge });
  }
  async consume(nonce: string) {
    const c = this.challenges.get(nonce);
    this.challenges.delete(nonce);
    return c;
  }
}

/** In-memory session store for tests and local development only. */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<Hex, WalletSession>();
  async put(session: WalletSession) {
    if (!TOKEN_HASH.test(session.tokenHash)) throw new Error("tokenHash must be a lowercase SHA-256 hex digest");
    this.sessions.set(session.tokenHash, { ...session });
  }
  async get(tokenHash: Hex) {
    const s = this.sessions.get(tokenHash);
    return s ? { ...s } : undefined;
  }
  async delete(tokenHash: Hex) {
    this.sessions.delete(tokenHash);
  }
}
