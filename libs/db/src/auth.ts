import type {
  ChallengeStore,
  LinkedWallet,
  SessionStore,
  UserRecord,
  UserStore,
  WalletChallenge,
  WalletSession,
} from "@monadeum/auth";
import type { Address, Hex } from "viem";
import { isUniqueViolation, type Database, type Queryable } from "./database.js";

interface UserRow {
  id: string;
  privy_user_id: string | null;
  owner_wallet: string | null;
  created_at: string;
  wallets: string;
}

interface WalletJson {
  address: Address;
  kind: LinkedWallet["kind"];
  proof: LinkedWallet["proof"];
  linkedAt: string;
}

// One statement reads the user and its wallets, so a read never mixes two versions of a record.
const SELECT_USER = `SELECT u.id, u.privy_user_id, u.owner_wallet, u.created_at::text AS created_at,
  COALESCE((SELECT json_agg(json_build_object('address', w.address, 'kind', w.kind, 'proof', w.proof, 'linkedAt', w.linked_at::text)
    ORDER BY w.position) FROM auth_user_wallets w WHERE w.user_id = u.id), '[]'::json)::text AS wallets
  FROM auth_users u`;

/**
 * `UserStore` on Postgres. One user row plus one row per linked wallet. The primary key on the lowercased wallet
 * address and the unique Privy user ID are what keep one person from becoming two users, including under concurrent
 * requests: each write is one transaction, and a constraint violation rolls it back and returns false.
 */
export class PgUserStore implements UserStore {
  constructor(private readonly db: Database) {}

  async get(id: string): Promise<UserRecord | undefined> {
    return this.load(`${SELECT_USER} WHERE u.id = $1`, [id]);
  }

  async byPrivyUserId(privyUserId: string): Promise<UserRecord | undefined> {
    return this.load(`${SELECT_USER} WHERE u.privy_user_id = $1`, [privyUserId]);
  }

  async byWallet(address: Address): Promise<UserRecord | undefined> {
    return this.load(`${SELECT_USER} WHERE u.id = (SELECT user_id FROM auth_user_wallets WHERE address_key = $1)`, [address.toLowerCase()]);
  }

  async create(record: UserRecord): Promise<boolean> {
    return this.write(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO auth_users (id, privy_user_id, owner_wallet, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [record.id, record.privyUserId, record.ownerWallet, record.createdAt],
      );
      if (rows.length === 0) return false;
      await insertWallets(tx, record);
      return true;
    });
  }

  async update(record: UserRecord): Promise<boolean> {
    return this.write(async (tx) => {
      // An owner wallet, once set, is never changed: the WHERE clause refuses the write in the same statement.
      const { rows } = await tx.query(
        `UPDATE auth_users SET privy_user_id = $2, owner_wallet = $3
         WHERE id = $1 AND (owner_wallet IS NULL OR lower(owner_wallet) = lower($3::text))
         RETURNING id`,
        [record.id, record.privyUserId, record.ownerWallet],
      );
      if (rows.length === 0) return false;
      await tx.query("DELETE FROM auth_user_wallets WHERE user_id = $1", [record.id]);
      await insertWallets(tx, record);
      return true;
    });
  }

  /** Runs one write transaction. A unique violation (a Privy ID or wallet another user holds) means false. */
  private async write(fn: (tx: Queryable) => Promise<boolean>): Promise<boolean> {
    try {
      return await this.db.transaction(fn);
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  private async load(sql: string, params: unknown[]): Promise<UserRecord | undefined> {
    const { rows } = await this.db.query<UserRow>(sql, params);
    const user = rows[0];
    if (!user) return undefined;
    const wallets = JSON.parse(user.wallets) as WalletJson[];
    return {
      id: user.id,
      privyUserId: user.privy_user_id,
      ownerWallet: user.owner_wallet as Address | null,
      wallets: wallets.map((w) => ({ address: w.address, kind: w.kind, proof: w.proof, linkedAt: Number(w.linkedAt) })),
      createdAt: Number(user.created_at),
    };
  }
}

async function insertWallets(tx: Queryable, record: UserRecord): Promise<void> {
  for (const [position, w] of record.wallets.entries()) {
    await tx.query(
      `INSERT INTO auth_user_wallets (address_key, user_id, position, address, kind, proof, linked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [w.address.toLowerCase(), record.id, position, w.address, w.kind, w.proof, w.linkedAt],
    );
  }
}

/** `ChallengeStore` on Postgres. `consume` is DELETE ... RETURNING, so a challenge is returned at most once. */
export class PgChallengeStore implements ChallengeStore {
  constructor(private readonly db: Database) {}

  async put(challenge: WalletChallenge): Promise<void> {
    try {
      await this.db.query(
        "INSERT INTO auth_challenges (nonce, message, address, purpose, user_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [challenge.nonce, challenge.message, challenge.address, challenge.purpose, challenge.userId, challenge.expiresAt],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("nonce reused");
      throw error;
    }
  }

  async consume(nonce: string): Promise<WalletChallenge | undefined> {
    const { rows } = await this.db.query<{
      nonce: string; message: string; address: string; purpose: WalletChallenge["purpose"]; user_id: string | null; expires_at: string;
    }>(
      "DELETE FROM auth_challenges WHERE nonce = $1 RETURNING nonce, message, address, purpose, user_id, expires_at::text AS expires_at",
      [nonce],
    );
    const r = rows[0];
    if (!r) return undefined;
    return { nonce: r.nonce, message: r.message, address: r.address as Address, purpose: r.purpose, userId: r.user_id, expiresAt: Number(r.expires_at) };
  }
}

/** `SessionStore` on Postgres. Only the token's SHA-256 is stored, and a CHECK constraint rejects anything else. */
export class PgSessionStore implements SessionStore {
  constructor(private readonly db: Database) {}

  async put(session: WalletSession): Promise<void> {
    if (!/^0x[0-9a-f]{64}$/.test(session.tokenHash)) throw new Error("tokenHash must be a lowercase SHA-256 hex digest");
    await this.db.query(
      `INSERT INTO auth_sessions (token_hash, user_id, wallet, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (token_hash) DO UPDATE SET user_id = EXCLUDED.user_id, wallet = EXCLUDED.wallet, expires_at = EXCLUDED.expires_at`,
      [session.tokenHash, session.userId, session.wallet, session.expiresAt],
    );
  }

  async get(tokenHash: Hex): Promise<WalletSession | undefined> {
    const { rows } = await this.db.query<{ token_hash: string; user_id: string; wallet: string; expires_at: string }>(
      "SELECT token_hash, user_id, wallet, expires_at::text AS expires_at FROM auth_sessions WHERE token_hash = $1",
      [tokenHash],
    );
    const r = rows[0];
    if (!r) return undefined;
    return { tokenHash: r.token_hash as Hex, userId: r.user_id, wallet: r.wallet as Address, expiresAt: Number(r.expires_at) };
  }

  async delete(tokenHash: Hex): Promise<void> {
    await this.db.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash]);
  }
}
