import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { OwnerSigner } from "@monadeum/wallets";
import { getAddress, isAddress, isAddressEqual, isHex, verifyMessage, type Address, type Hex } from "viem";
import { createSiweMessage } from "viem/siwe";
import type { AuthSettings } from "./config.js";
import { PrivyTokenError, type PrivyIdentity, type PrivyVerifier } from "./privy.js";
import type { ChallengeStore, LinkedWallet, SessionStore, UserRecord, UserStore } from "./store.js";

/**
 * Who is calling, established by a verified credential. A principal is authentication only: it never authorizes
 * an action by itself (THREAT-MODEL.md trust boundary 10). Only principals this service issued are accepted back.
 */
export interface Principal {
  readonly userId: string;
  readonly via: "privy" | "wallet";
  /** Unix milliseconds after which the principal is no longer accepted. */
  readonly expiresAt: number;
}

export type AuthFailureReason =
  | "invalid-token"
  | "token-mismatch"
  | "guest-not-supported"
  | "unknown-user"
  | "unknown-principal"
  | "expired"
  | "identity-linked-elsewhere"
  | "wallet-linked-elsewhere"
  | "ambiguous-embedded-wallet"
  | "invalid-address"
  | "invalid-challenge"
  | "bad-signature"
  | "no-owner-wallet"
  | "not-owner"
  | "conflict";

export type AuthFailure = { ok: false; reason: AuthFailureReason; detail?: string };
export type SignInResult = { ok: true; user: UserRecord; principal: Principal; created: boolean } | AuthFailure;
export type WalletSignInResult = { ok: true; user: UserRecord; principal: Principal; sessionToken: string; created: boolean } | AuthFailure;
export type LinkResult = { ok: true; user: UserRecord } | AuthFailure;
export type PrincipalResult = { ok: true; principal: Principal } | AuthFailure;
export type ChallengeResult = { ok: true; nonce: string; message: string; expiresAt: number } | AuthFailure;
export type OwnershipResult = { ok: true; userId: string; owner: Address } | AuthFailure;

/**
 * The embedded wallet provisioning callback. Called once per user, when the platform first verifies the wallet that
 * will own the user's agent accounts. No account is deployed here: an agent account is deployed per agent, by
 * AgentsModule calling WalletsService.deploy with an OwnerSigner whose address is this owner (ARCHITECTURE.md
 * section 10). Implementations must be idempotent; the owner is already recorded when this is called, so a missed
 * or failed notification loses nothing that `ownerWallet` in the store does not hold.
 */
export interface OwnerWalletHandoff {
  ownerWalletReady(event: { userId: string; owner: Address; kind: LinkedWallet["kind"] }): Promise<void>;
}

const noHandoff: OwnerWalletHandoff = { ownerWalletReady: async () => {} };

const fail = (reason: AuthFailureReason, detail?: string): AuthFailure => ({ ok: false, reason, ...(detail ? { detail } : {}) });
const hashToken = (token: string): Hex => `0x${createHash("sha256").update(token).digest("hex")}`;

const STATEMENT = "Sign in to Monadeum. This signature proves you control this wallet. It does not authorize any transaction.";
const LINK_STATEMENT = "Link this wallet to your Monadeum account. This signature does not authorize any transaction.";

/**
 * AuthModule logic, ARCHITECTURE.md section 10. Social login through Privy is the primary path; an external wallet
 * is the secondary path. Both resolve to one UserRecord, and a Privy identity or a wallet is never attached to two
 * users: a link that would do so is refused, never merged.
 *
 * Authentication only. This service decides who the caller is and which wallet owns their agents. It holds no key,
 * signs nothing, and never returns a signer: an owner-signed operation still needs the owner wallet's signature
 * through WalletsModule, and an action on an agent's capital still passes the RiskModule and the on-chain validator.
 */
export class AuthService {
  private readonly issued = new WeakSet<Principal>();

  constructor(
    private readonly privy: PrivyVerifier,
    private readonly users: UserStore,
    private readonly challenges: ChallengeStore,
    private readonly sessions: SessionStore,
    private readonly settings: AuthSettings,
    private readonly handoff: OwnerWalletHandoff = noHandoff,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = randomUUID,
  ) {}

  // Primary path: social login through Privy.

  /**
   * First sign-in, and any sign-in that should pick up a newly created embedded wallet. Both tokens are verified
   * locally and must name the same Privy user. The identity token is the only source of the embedded wallet
   * address: an address the client states is never used (THREAT-MODEL.md trust boundary 10).
   */
  async signInWithPrivy(input: { accessToken: string; identityToken: string }): Promise<SignInResult> {
    const verified = await this.verifyPrivy(input.accessToken, input.identityToken);
    if (!verified.ok) return verified;
    const { session, identity } = verified;

    let user = await this.users.byPrivyUserId(identity.privyUserId);
    let created = false;
    if (!user) {
      const fresh: UserRecord = { id: this.newId(), privyUserId: identity.privyUserId, ownerWallet: null, wallets: [], createdAt: this.now() };
      if (await this.users.create(fresh)) {
        user = fresh;
        created = true;
      } else {
        // A concurrent first sign-in for the same Privy user won the insert.
        user = await this.users.byPrivyUserId(identity.privyUserId);
        if (!user) return fail("conflict", "user could not be created");
      }
    }
    const applied = await this.applyEmbeddedWallets(user, identity);
    if (!applied.ok) return applied;
    return { ok: true, user: applied.user, principal: this.issue(applied.user.id, "privy", session.expiresAt * 1000), created };
  }

  /** Per request on the primary path: a verified Privy access token for a user who has signed in. */
  async authenticatePrivy(accessToken: string): Promise<PrincipalResult> {
    let session;
    try {
      session = await this.privy.verifyAccessToken(accessToken);
    } catch (error) {
      return fail("invalid-token", error instanceof PrivyTokenError ? error.message : undefined);
    }
    const user = await this.users.byPrivyUserId(session.privyUserId);
    if (!user) return fail("unknown-user", "sign in with an identity token first");
    return { ok: true, principal: this.issue(user.id, "privy", session.expiresAt * 1000) };
  }

  // Secondary path: an external wallet, proven by an EIP-4361 signature.

  /**
   * Issues a one-time EIP-4361 message for `address` to sign. A `link` challenge is bound to the authenticated
   * user that asked for it, so it cannot be used to sign in, and a `sign-in` challenge cannot be used to link.
   */
  async walletChallenge(input: { address: string; purpose: "sign-in" } | { address: string; purpose: "link"; principal: Principal }): Promise<ChallengeResult> {
    if (!isAddress(input.address, { strict: false })) return fail("invalid-address");
    const address = getAddress(input.address);
    let userId: string | null = null;
    if (input.purpose === "link") {
      const checked = this.check(input.principal);
      if (!checked.ok) return checked;
      userId = input.principal.userId;
    }
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = new Date(this.now());
    const expiresAt = this.now() + this.settings.challengeTtlMs;
    const message = createSiweMessage({
      address,
      chainId: this.settings.chainId,
      domain: this.settings.domain,
      uri: this.settings.uri,
      version: "1",
      nonce,
      issuedAt,
      expirationTime: new Date(expiresAt),
      statement: input.purpose === "link" ? LINK_STATEMENT : STATEMENT,
    });
    await this.challenges.put({ nonce, message, address, purpose: input.purpose, userId, expiresAt });
    return { ok: true, nonce, message, expiresAt };
  }

  /**
   * Signs in with an external wallet. A wallet already linked to a user, whichever path linked it, signs in as that
   * user. An unknown wallet creates a user whose owner wallet is this wallet. Returns an opaque session token; only
   * its hash is stored.
   */
  async signInWithWallet(input: { nonce: string; signature: string }): Promise<WalletSignInResult> {
    const proven = await this.proveWallet(input.nonce, input.signature, "sign-in");
    if (!proven.ok) return proven;
    const address = proven.address;

    let user = await this.users.byWallet(address);
    let created = false;
    if (!user) {
      const fresh: UserRecord = {
        id: this.newId(),
        privyUserId: null,
        ownerWallet: address,
        wallets: [{ address, kind: "external", proof: "wallet-signature", linkedAt: this.now() }],
        createdAt: this.now(),
      };
      if (await this.users.create(fresh)) {
        user = fresh;
        created = true;
        await this.handoff.ownerWalletReady({ userId: fresh.id, owner: address, kind: "external" });
      } else {
        user = await this.users.byWallet(address);
        if (!user) return fail("conflict", "user could not be created");
      }
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + this.settings.walletSessionTtlMs;
    await this.sessions.put({ tokenHash: hashToken(token), userId: user.id, wallet: address, expiresAt });
    return { ok: true, user, principal: this.issue(user.id, "wallet", expiresAt), sessionToken: token, created };
  }

  /** Per request on the external wallet path. */
  async authenticateWalletSession(sessionToken: string): Promise<PrincipalResult> {
    const session = await this.sessions.get(hashToken(sessionToken));
    if (!session) return fail("invalid-token");
    if (session.expiresAt <= this.now()) {
      await this.sessions.delete(session.tokenHash);
      return fail("expired");
    }
    const user = await this.users.get(session.userId);
    // The wallet must still belong to the session's user; a session never outlives the link it was opened with.
    if (!user || !user.wallets.some((w) => isAddressEqual(w.address, session.wallet))) {
      await this.sessions.delete(session.tokenHash);
      return fail("unknown-user");
    }
    return { ok: true, principal: this.issue(user.id, "wallet", session.expiresAt) };
  }

  async signOut(sessionToken: string): Promise<void> {
    await this.sessions.delete(hashToken(sessionToken));
  }

  // Linking: both directions converge on the authenticated user's one record.

  /** Adds an external wallet to the authenticated user. Never changes the owner wallet. */
  async linkWallet(input: { principal: Principal; nonce: string; signature: string }): Promise<LinkResult> {
    const checked = this.check(input.principal);
    if (!checked.ok) return checked;
    const proven = await this.proveWallet(input.nonce, input.signature, "link", input.principal.userId);
    if (!proven.ok) return proven;
    const user = await this.users.get(input.principal.userId);
    if (!user) return fail("unknown-user");
    if (user.wallets.some((w) => isAddressEqual(w.address, proven.address))) return { ok: true, user };
    const holder = await this.users.byWallet(proven.address);
    if (holder) return fail("wallet-linked-elsewhere");
    const next: UserRecord = { ...user, wallets: [...user.wallets, { address: proven.address, kind: "external", proof: "wallet-signature", linkedAt: this.now() }] };
    if (!(await this.users.update(next))) return fail("wallet-linked-elsewhere");
    return { ok: true, user: next };
  }

  /**
   * Adds a Privy identity, and its embedded wallets, to the authenticated user: the path for a user who started
   * with an external wallet and later uses social login. After this, signing in through Privy resolves to the same
   * user. A Privy identity that already belongs to another user is refused, never merged.
   */
  async linkPrivy(input: { principal: Principal; accessToken: string; identityToken: string }): Promise<LinkResult> {
    const checked = this.check(input.principal);
    if (!checked.ok) return checked;
    const verified = await this.verifyPrivy(input.accessToken, input.identityToken);
    if (!verified.ok) return verified;
    const { identity } = verified;
    const user = await this.users.get(input.principal.userId);
    if (!user) return fail("unknown-user");
    if (user.privyUserId !== null && user.privyUserId !== identity.privyUserId) return fail("conflict", "user is linked to a different Privy identity");
    const holder = await this.users.byPrivyUserId(identity.privyUserId);
    if (holder && holder.id !== user.id) return fail("identity-linked-elsewhere");
    // One update carries the Privy ID and the embedded wallets together, so a refused wallet links neither.
    return this.applyEmbeddedWallets({ ...user, privyUserId: identity.privyUserId }, identity, user.privyUserId === null);
  }

  // Authorization inputs. Neither of these authorizes an action on its own.

  /**
   * Whether the authenticated user owns an agent whose owner the caller read from its own records or from chain,
   * never from the request (THREAT-MODEL.md trust boundary 10). Ownership is the user's one owner wallet; a linked
   * wallet that is not the owner wallet owns nothing. A positive result only allows the caller to ask the owner
   * wallet for a signature; it is not itself that signature.
   */
  async checkOwnership(principal: Principal, agentOwner: Address): Promise<OwnershipResult> {
    const checked = this.check(principal);
    if (!checked.ok) return checked;
    const user = await this.users.get(principal.userId);
    if (!user) return fail("unknown-user");
    if (!user.ownerWallet) return fail("no-owner-wallet");
    if (!isAddressEqual(user.ownerWallet, agentOwner)) return fail("not-owner");
    return { ok: true, userId: user.id, owner: user.ownerWallet };
  }

  /**
   * Accepts an OwnerSigner for WalletsModule only if its address is the authenticated user's owner wallet. The
   * signer itself relays every signature request to that wallet for the user's approval: the session supplies no
   * signature, so an authenticated caller without the wallet still cannot complete an owner-signed operation.
   */
  async ownerSignerFor<S extends OwnerSigner>(principal: Principal, signer: S): Promise<{ ok: true; signer: S } | AuthFailure> {
    const checked = this.check(principal);
    if (!checked.ok) return checked;
    const user = await this.users.get(principal.userId);
    if (!user) return fail("unknown-user");
    if (!user.ownerWallet) return fail("no-owner-wallet");
    if (!isAddressEqual(user.ownerWallet, signer.address)) return fail("not-owner");
    return { ok: true, signer };
  }

  async user(principal: Principal): Promise<UserRecord | AuthFailure> {
    const checked = this.check(principal);
    if (!checked.ok) return checked;
    return (await this.users.get(principal.userId)) ?? fail("unknown-user");
  }

  // Internals.

  private issue(userId: string, via: Principal["via"], expiresAt: number): Principal {
    const principal: Principal = Object.freeze({ userId, via, expiresAt });
    this.issued.add(principal);
    return principal;
  }

  private check(principal: Principal): { ok: true } | AuthFailure {
    if (!this.issued.has(principal)) return fail("unknown-principal", "principal was not issued by this service");
    if (principal.expiresAt <= this.now()) return fail("expired");
    return { ok: true };
  }

  private async verifyPrivy(accessToken: string, identityToken: string) {
    let session, identity: PrivyIdentity;
    try {
      session = await this.privy.verifyAccessToken(accessToken);
      identity = await this.privy.verifyIdentityToken(identityToken);
    } catch (error) {
      return fail("invalid-token", error instanceof PrivyTokenError ? error.message : undefined);
    }
    if (session.privyUserId !== identity.privyUserId) return fail("token-mismatch");
    // A guest's embedded wallet has no login method to recover it, and it would own agent capital.
    if (identity.isGuest) return fail("guest-not-supported");
    return { ok: true as const, session, identity };
  }

  /**
   * The embedded wallet provisioning callback. Links every embedded wallet the verified identity token lists, and
   * if the user has no owner wallet yet, makes the embedded wallet the owner and notifies the handoff. More than
   * one candidate with no owner yet is refused rather than guessed.
   */
  private async applyEmbeddedWallets(user: UserRecord, identity: PrivyIdentity, changed = false): Promise<LinkResult> {
    const added: LinkedWallet[] = [];
    for (const address of identity.embeddedWallets) {
      if (user.wallets.some((w) => isAddressEqual(w.address, address))) continue;
      const holder = await this.users.byWallet(address);
      if (holder && holder.id !== user.id) return fail("wallet-linked-elsewhere");
      added.push({ address, kind: "embedded", proof: "privy-identity-token", linkedAt: this.now() });
    }
    let owner = user.ownerWallet;
    let ownerSet = false;
    if (owner === null && identity.embeddedWallets.length > 0) {
      if (identity.embeddedWallets.length > 1) return fail("ambiguous-embedded-wallet");
      owner = identity.embeddedWallets[0]!;
      ownerSet = true;
    }
    if (added.length === 0 && !ownerSet && !changed) return { ok: true, user };
    const next: UserRecord = { ...user, ownerWallet: owner, wallets: [...user.wallets, ...added] };
    if (!(await this.users.update(next))) return fail("conflict", "a Privy identity or wallet was linked to another user concurrently");
    if (ownerSet) await this.handoff.ownerWalletReady({ userId: next.id, owner: owner!, kind: "embedded" });
    return { ok: true, user: next };
  }

  private async proveWallet(nonce: string, signature: string, purpose: "sign-in" | "link", userId: string | null = null) {
    if (typeof nonce !== "string" || typeof signature !== "string" || !isHex(signature)) return fail("invalid-challenge");
    // Consumed before verification, so a challenge is spent by its first use whether or not it succeeds.
    const challenge = await this.challenges.consume(nonce);
    if (!challenge || challenge.purpose !== purpose || challenge.userId !== userId) return fail("invalid-challenge");
    if (challenge.expiresAt <= this.now()) return fail("invalid-challenge", "challenge expired");
    let valid = false;
    try {
      // Recovers the signer locally. Contract wallets (ERC-1271) are not supported on this path and fail here.
      valid = await verifyMessage({ address: challenge.address, message: challenge.message, signature: signature as Hex });
    } catch {
      valid = false;
    }
    if (!valid) return fail("bad-signature");
    return { ok: true as const, address: challenge.address };
  }
}
