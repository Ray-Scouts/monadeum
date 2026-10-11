import assert from "node:assert/strict";
import { test } from "node:test";
import type { OwnerSigner } from "@monadeum/wallets";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  AuthConfigError,
  AuthService,
  MemoryChallengeStore,
  MemorySessionStore,
  MemoryUserStore,
  PrivyTokenError,
  PrivyTokenVerifier,
  loadAuthConfig,
  type AuthSettings,
  type OwnerWalletHandoff,
  type Principal,
} from "../src/index.js";
import { APP_ID, PrivyIssuer, embedded } from "./privy-issuer.js";

const settings: AuthSettings = { chainId: 10143, domain: "app.example.test", uri: "https://app.example.test", challengeTtlMs: 300_000, walletSessionTtlMs: 3_600_000 };

function setup(clock?: { now: number }) {
  const issuer = new PrivyIssuer();
  const verifier = new PrivyTokenVerifier(APP_ID, issuer.publicKeyPem);
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  const handoffs: { userId: string; owner: Address; kind: string }[] = [];
  const handoff: OwnerWalletHandoff = { ownerWalletReady: async (e) => void handoffs.push(e) };
  let n = 0;
  const now = clock ? () => clock.now : Date.now;
  const service = new AuthService(verifier, users, new MemoryChallengeStore(), sessions, settings, handoff, now, () => `user-${++n}`);
  return { issuer, verifier, users, sessions, handoffs, service };
}

// Generated per test run, never persisted. Stand in for embedded and external wallets.
const wallet = () => privateKeyToAccount(generatePrivateKey());

async function walletSignIn(service: AuthService, account = wallet()) {
  const challenge = await service.walletChallenge({ address: account.address, purpose: "sign-in" });
  assert.ok(challenge.ok);
  const signature = await account.signMessage({ message: challenge.message });
  return { account, result: await service.signInWithWallet({ nonce: challenge.nonce, signature }) };
}

async function linkExternal(service: AuthService, principal: Principal, account = wallet()) {
  const challenge = await service.walletChallenge({ address: account.address, purpose: "link", principal });
  assert.ok(challenge.ok);
  const signature = await account.signMessage({ message: challenge.message });
  return service.linkWallet({ principal, nonce: challenge.nonce, signature });
}

// Privy token verification, through the installed @privy-io/node code.

test("a Privy access token signed with the app's key, for the app, by privy.io, verifies", async () => {
  const { issuer, verifier } = setup();
  const session = await verifier.verifyAccessToken(issuer.accessToken("did:privy:alice"));
  assert.equal(session.privyUserId, "did:privy:alice");
  assert.equal(session.sessionId, "session-did:privy:alice");
});

test("access tokens with the wrong audience, issuer, expiry, key, or algorithm are rejected", async () => {
  const { issuer, verifier } = setup();
  const other = new PrivyIssuer();
  const past = Math.floor(Date.now() / 1000) - 7200;
  const bad = [
    issuer.accessToken("did:privy:a", { aud: "another-app" }),
    issuer.accessToken("did:privy:a", { iss: "evil.example" }),
    issuer.accessToken("did:privy:a", { iat: past, exp: past + 60 }),
    other.accessToken("did:privy:a"),
    issuer.jwt({ sid: "s", sub: "did:privy:a", iss: "privy.io", aud: APP_ID, iat: 1, exp: 9_999_999_999 }, { alg: "none", typ: "JWT" }),
    `${issuer.accessToken("did:privy:a").split(".").slice(0, 2).join(".")}.`,
    "not a token",
  ];
  for (const token of bad) await assert.rejects(verifier.verifyAccessToken(token), PrivyTokenError);
});

test("the identity token yields only Privy embedded Ethereum wallets", async () => {
  const { issuer, verifier } = setup();
  const mine = wallet().address;
  const identity = await verifier.verifyIdentityToken(
    issuer.identityToken("did:privy:a", [
      { type: "email", address: "a@example.test", lv: 1 },
      embedded(mine.toLowerCase()),
      { type: "wallet", address: wallet().address, chain_type: "ethereum", wallet_client_type: "metamask", lv: 1 },
      { type: "wallet", address: "So1anaAddre55", chain_type: "solana", wallet_client_type: "privy", lv: 1 },
    ]),
  );
  assert.deepEqual(identity.embeddedWallets, [mine]);
  assert.equal(identity.isGuest, false);
  await assert.rejects(verifier.verifyIdentityToken(new PrivyIssuer().identityToken("did:privy:a", [])), PrivyTokenError);
});

test("a privy-v2 embedded wallet counts as embedded; an external wallet never does", async () => {
  const { issuer, verifier } = setup();
  const mine = wallet().address;
  const identity = await verifier.verifyIdentityToken(
    issuer.identityToken("did:privy:a", [
      { type: "wallet", address: mine, chain_type: "ethereum", wallet_client_type: "privy-v2", id: "w2", lv: 1 },
      { type: "wallet", address: wallet().address, chain_type: "ethereum", wallet_client_type: "coinbase_wallet", lv: 1 },
      { type: "wallet", address: "not-an-address", chain_type: "ethereum", wallet_client_type: "privy-v2", lv: 1 },
    ]),
  );
  assert.deepEqual(identity.embeddedWallets, [mine]);
});

// Primary path.

test("social sign-in creates one user whose owner wallet is the embedded wallet, and hands it off once", async () => {
  const { issuer, service, handoffs } = setup();
  const e = wallet().address;
  const tokens = { accessToken: issuer.accessToken("did:privy:a"), identityToken: issuer.identityToken("did:privy:a", [embedded(e)]) };
  const first = await service.signInWithPrivy(tokens);
  assert.ok(first.ok);
  assert.equal(first.created, true);
  assert.equal(first.user.ownerWallet, e);
  assert.deepEqual(first.user.wallets.map((w) => [w.address, w.kind, w.proof]), [[e, "embedded", "privy-identity-token"]]);
  assert.deepEqual(handoffs, [{ userId: first.user.id, owner: e, kind: "embedded" }]);

  const again = await service.signInWithPrivy(tokens);
  assert.ok(again.ok);
  assert.equal(again.created, false);
  assert.equal(again.user.id, first.user.id);
  assert.equal(handoffs.length, 1);

  const perRequest = await service.authenticatePrivy(issuer.accessToken("did:privy:a"));
  assert.ok(perRequest.ok);
  assert.equal(perRequest.principal.userId, first.user.id);
  assert.equal(perRequest.principal.via, "privy");
});

test("an embedded wallet created after the first sign-in becomes the owner on a later sign-in", async () => {
  const { issuer, service, handoffs } = setup();
  const first = await service.signInWithPrivy({ accessToken: issuer.accessToken("did:privy:a"), identityToken: issuer.identityToken("did:privy:a", []) });
  assert.ok(first.ok);
  assert.equal(first.user.ownerWallet, null);
  assert.equal(handoffs.length, 0);
  const e = wallet().address;
  const later = await service.signInWithPrivy({ accessToken: issuer.accessToken("did:privy:a"), identityToken: issuer.identityToken("did:privy:a", [embedded(e)]) });
  assert.ok(later.ok);
  assert.equal(later.user.id, first.user.id);
  assert.equal(later.user.ownerWallet, e);
  assert.equal(handoffs.length, 1);
});

test("two embedded wallets and no owner yet is refused rather than guessed", async () => {
  const { issuer, service } = setup();
  const r = await service.signInWithPrivy({
    accessToken: issuer.accessToken("did:privy:a"),
    identityToken: issuer.identityToken("did:privy:a", [embedded(wallet().address), embedded(wallet().address)]),
  });
  assert.deepEqual(r, { ok: false, reason: "ambiguous-embedded-wallet" });
});

test("mismatched tokens, guest users, and users who never signed in are refused", async () => {
  const { issuer, service } = setup();
  const mismatch = await service.signInWithPrivy({ accessToken: issuer.accessToken("did:privy:a"), identityToken: issuer.identityToken("did:privy:b", []) });
  assert.equal(!mismatch.ok && mismatch.reason, "token-mismatch");
  const guest = await service.signInWithPrivy({ accessToken: issuer.accessToken("did:privy:g"), identityToken: issuer.identityToken("did:privy:g", [embedded(wallet().address)], { guest: "t" }) });
  assert.equal(!guest.ok && guest.reason, "guest-not-supported");
  const unknown = await service.authenticatePrivy(issuer.accessToken("did:privy:never"));
  assert.equal(!unknown.ok && unknown.reason, "unknown-user");
  const forged = await service.authenticatePrivy(new PrivyIssuer().accessToken("did:privy:a"));
  assert.equal(!forged.ok && forged.reason, "invalid-token");
});

test("concurrent first sign-ins for one Privy user create one user", async () => {
  const { issuer, service } = setup();
  const e = wallet().address;
  const tokens = { accessToken: issuer.accessToken("did:privy:a"), identityToken: issuer.identityToken("did:privy:a", [embedded(e)]) };
  const [a, b] = await Promise.all([service.signInWithPrivy(tokens), service.signInWithPrivy(tokens)]);
  assert.ok(a.ok && b.ok);
  assert.equal(a.user.id, b.user.id);
});

// Convergence: one account, whichever path came first.

test("social login first, then an external wallet: one account, owner unchanged", async () => {
  const { issuer, service, users } = setup();
  const e = wallet().address;
  const social = await service.signInWithPrivy({ accessToken: issuer.accessToken("did:privy:a"), identityToken: issuer.identityToken("did:privy:a", [embedded(e)]) });
  assert.ok(social.ok);

  const x = wallet();
  const linked = await linkExternal(service, social.principal, x);
  assert.ok(linked.ok);
  assert.equal(linked.user.ownerWallet, e);

  const viaWallet = await walletSignIn(service, x);
  assert.ok(viaWallet.result.ok);
  assert.equal(viaWallet.result.created, false);
  assert.equal(viaWallet.result.user.id, social.user.id);

  const viaPrivy = await service.authenticatePrivy(issuer.accessToken("did:privy:a"));
  assert.ok(viaPrivy.ok);
  assert.equal(viaPrivy.principal.userId, social.user.id);

  const record = await users.get(social.user.id);
  assert.deepEqual(record?.wallets.map((w) => [w.address, w.kind]), [[e, "embedded"], [x.address, "external"]]);
  assert.equal((await users.byWallet(x.address))?.id, social.user.id);
  assert.equal((await users.byWallet(e))?.id, social.user.id);
});

test("external wallet first, then social login: one account, owner unchanged", async () => {
  const { issuer, service, users, handoffs } = setup();
  const x = wallet();
  const first = await walletSignIn(service, x);
  assert.ok(first.result.ok);
  assert.equal(first.result.created, true);
  assert.equal(first.result.user.ownerWallet, x.address);
  assert.equal(first.result.user.privyUserId, null);
  assert.deepEqual(handoffs, [{ userId: first.result.user.id, owner: x.address, kind: "external" }]);

  const e = wallet().address;
  const linked = await service.linkPrivy({ principal: first.result.principal, accessToken: issuer.accessToken("did:privy:a"), identityToken: issuer.identityToken("did:privy:a", [embedded(e)]) });
  assert.ok(linked.ok);
  assert.equal(linked.user.ownerWallet, x.address);
  assert.equal(handoffs.length, 1);

  const social = await service.signInWithPrivy({ accessToken: issuer.accessToken("did:privy:a"), identityToken: issuer.identityToken("did:privy:a", [embedded(e)]) });
  assert.ok(social.ok);
  assert.equal(social.created, false);
  assert.equal(social.user.id, first.result.user.id);
  assert.equal((await users.byWallet(e))?.id, first.result.user.id);
  assert.equal((await users.byPrivyUserId("did:privy:a"))?.id, first.result.user.id);
});

test("a wallet or a Privy identity that belongs to another user is refused, never merged", async () => {
  const { issuer, service, users } = setup();
  const alice = await service.signInWithPrivy({ accessToken: issuer.accessToken("did:privy:alice"), identityToken: issuer.identityToken("did:privy:alice", [embedded(wallet().address)]) });
  const bob = await walletSignIn(service);
  assert.ok(alice.ok && bob.result.ok);

  const stealWallet = await linkExternal(service, alice.principal, bob.account);
  assert.equal(!stealWallet.ok && stealWallet.reason, "wallet-linked-elsewhere");

  const stealIdentity = await service.linkPrivy({ principal: bob.result.principal, accessToken: issuer.accessToken("did:privy:alice"), identityToken: issuer.identityToken("did:privy:alice", []) });
  assert.equal(!stealIdentity.ok && stealIdentity.reason, "identity-linked-elsewhere");

  // An identity token listing another user's wallet as embedded changes nothing either.
  const carol = await service.signInWithPrivy({ accessToken: issuer.accessToken("did:privy:carol"), identityToken: issuer.identityToken("did:privy:carol", [embedded(bob.account.address)]) });
  assert.equal(!carol.ok && carol.reason, "wallet-linked-elsewhere");

  assert.equal((await users.get(alice.user.id))?.wallets.length, 1);
  assert.equal((await users.get(bob.result.user.id))?.privyUserId, null);
  assert.equal((await users.byWallet(bob.account.address))?.id, bob.result.user.id);
});

// Wallet challenges and sessions.

test("a challenge is single-use, purpose-bound, user-bound, expiring, and needs the wallet's own signature", async () => {
  const clock = { now: 1_000_000 };
  const { service } = setup(clock);
  const x = wallet();

  const c = await service.walletChallenge({ address: x.address, purpose: "sign-in" });
  assert.ok(c.ok);
  assert.match(c.message, /Chain ID: 10143/);
  assert.match(c.message, /^app\.example\.test wants you to sign in/);
  const signature = await x.signMessage({ message: c.message });
  assert.ok((await service.signInWithWallet({ nonce: c.nonce, signature })).ok);
  const replay = await service.signInWithWallet({ nonce: c.nonce, signature });
  assert.equal(!replay.ok && replay.reason, "invalid-challenge");

  const wrongKey = await service.walletChallenge({ address: x.address, purpose: "sign-in" });
  assert.ok(wrongKey.ok);
  const forged = await service.signInWithWallet({ nonce: wrongKey.nonce, signature: await wallet().signMessage({ message: wrongKey.message }) });
  assert.equal(!forged.ok && forged.reason, "bad-signature");

  const late = await service.walletChallenge({ address: x.address, purpose: "sign-in" });
  assert.ok(late.ok);
  const lateSig = await x.signMessage({ message: late.message });
  clock.now += settings.challengeTtlMs;
  const expired = await service.signInWithWallet({ nonce: late.nonce, signature: lateSig });
  assert.equal(!expired.ok && expired.reason, "invalid-challenge");

  // A sign-in challenge cannot link, and a link challenge cannot sign in or link to another user.
  const me = await walletSignIn(service);
  const other = await walletSignIn(service);
  assert.ok(me.result.ok && other.result.ok);
  const y = wallet();
  const signIn = await service.walletChallenge({ address: y.address, purpose: "sign-in" });
  assert.ok(signIn.ok);
  const asLink = await service.linkWallet({ principal: me.result.principal, nonce: signIn.nonce, signature: await y.signMessage({ message: signIn.message }) });
  assert.equal(!asLink.ok && asLink.reason, "invalid-challenge");
  const link = await service.walletChallenge({ address: y.address, purpose: "link", principal: me.result.principal });
  assert.ok(link.ok);
  const linkSig = await y.signMessage({ message: link.message });
  const asOther = await service.linkWallet({ principal: other.result.principal, nonce: link.nonce, signature: linkSig });
  assert.equal(!asOther.ok && asOther.reason, "invalid-challenge");
  const link2 = await service.walletChallenge({ address: y.address, purpose: "link", principal: me.result.principal });
  assert.ok(link2.ok);
  const asSignIn = await service.signInWithWallet({ nonce: link2.nonce, signature: await y.signMessage({ message: link2.message }) });
  assert.equal(!asSignIn.ok && asSignIn.reason, "invalid-challenge");

  assert.equal((await service.walletChallenge({ address: "0x1234", purpose: "sign-in" })).ok, false);
});

test("a wallet session token authenticates until it expires or the user signs out, and only its hash is stored", async () => {
  const clock = { now: 5_000_000 };
  const { service, sessions } = setup(clock);
  const { result } = await walletSignIn(service);
  assert.ok(result.ok);
  const auth = await service.authenticateWalletSession(result.sessionToken);
  assert.ok(auth.ok);
  assert.equal(auth.principal.userId, result.user.id);
  assert.equal(auth.principal.via, "wallet");
  assert.equal(await sessions.get(result.sessionToken as Hex), undefined);

  await service.signOut(result.sessionToken);
  assert.equal((await service.authenticateWalletSession(result.sessionToken)).ok, false);

  const second = await walletSignIn(service);
  assert.ok(second.result.ok);
  clock.now += settings.walletSessionTtlMs;
  const expired = await service.authenticateWalletSession(second.result.sessionToken);
  assert.equal(!expired.ok && expired.reason, "expired");
});

// Authentication is not authorization.

test("a principal not issued by the service, or expired, is refused everywhere", async () => {
  const clock = { now: 9_000_000 };
  const { service } = setup(clock);
  const { result } = await walletSignIn(service);
  assert.ok(result.ok);
  const handmade: Principal = { userId: result.user.id, via: "wallet", expiresAt: Number.MAX_SAFE_INTEGER };
  const owner = result.user.ownerWallet!;
  assert.equal((await service.checkOwnership(handmade, owner)).ok, false);
  assert.equal((await service.walletChallenge({ address: owner, purpose: "link", principal: handmade })).ok, false);
  assert.equal((await service.linkWallet({ principal: handmade, nonce: "x", signature: "0x00" })).ok, false);

  assert.ok((await service.checkOwnership(result.principal, owner)).ok);
  clock.now = result.principal.expiresAt;
  const late = await service.checkOwnership(result.principal, owner);
  assert.equal(!late.ok && late.reason, "expired");
});

test("ownership is the user's one owner wallet: a linked wallet or another user's agent grants nothing", async () => {
  const { issuer, service } = setup();
  const e = wallet().address;
  const alice = await service.signInWithPrivy({ accessToken: issuer.accessToken("did:privy:a"), identityToken: issuer.identityToken("did:privy:a", [embedded(e)]) });
  assert.ok(alice.ok);
  const x = wallet();
  assert.ok((await linkExternal(service, alice.principal, x)).ok);
  const bob = await walletSignIn(service);
  assert.ok(bob.result.ok);

  assert.deepEqual(await service.checkOwnership(alice.principal, e), { ok: true, userId: alice.user.id, owner: e });
  const viaLinked = await service.checkOwnership(alice.principal, x.address);
  assert.equal(!viaLinked.ok && viaLinked.reason, "not-owner");
  const othersAgent = await service.checkOwnership(alice.principal, bob.account.address);
  assert.equal(!othersAgent.ok && othersAgent.reason, "not-owner");

  // Signed in through the linked external wallet, Alice still owns through the embedded wallet only.
  const viaWallet = await walletSignIn(service, x);
  assert.ok(viaWallet.result.ok);
  assert.ok((await service.checkOwnership(viaWallet.result.principal, e)).ok);
  assert.equal((await service.checkOwnership(viaWallet.result.principal, x.address)).ok, false);
});

test("an owner-signed operation needs the owner wallet's signer: the session supplies none", async () => {
  const { service } = setup();
  const { account, result } = await walletSignIn(service);
  assert.ok(result.ok);
  const own: OwnerSigner = { address: account.address, signer: account };
  const accepted = await service.ownerSignerFor(result.principal, own);
  assert.ok(accepted.ok);
  assert.equal(accepted.signer, own);

  // Bob's session with a signer that is not his owner wallet, for example a key the API generated, is refused.
  const imposter = wallet();
  const refused = await service.ownerSignerFor(result.principal, { address: imposter.address, signer: imposter });
  assert.equal(!refused.ok && refused.reason, "not-owner");

  // The service exposes no way to sign: authentication yields a principal, never a key or a signature.
  const methods = Object.getOwnPropertyNames(AuthService.prototype);
  assert.equal(methods.some((m) => /sign(Message|Typed|Transaction|UserOperation)|privateKey/i.test(m)), false);
  assert.equal(Object.isFrozen(result.principal), true);
  assert.deepEqual(Object.keys(result.principal).sort(), ["expiresAt", "userId", "via"]);
});

// Configuration.

test("configuration accepts Monad testnet and an https or localhost origin, and nothing else", () => {
  const { issuer } = setup();
  const env = {
    AUTH_PRIVY_APP_ID: APP_ID,
    AUTH_PRIVY_VERIFICATION_KEY: issuer.publicKeyPem.replaceAll("\n", "\\n"),
    AUTH_CHAIN_ID: "10143",
    AUTH_SIWE_DOMAIN: "app.example.test",
    AUTH_SIWE_URI: "https://app.example.test",
  };
  const config = loadAuthConfig(env);
  assert.equal(config.privy.verificationKey, issuer.publicKeyPem);
  assert.equal(config.settings.challengeTtlMs, 300_000);
  assert.equal(config.settings.walletSessionTtlMs, 3_600_000);
  assert.equal(loadAuthConfig({ ...env, AUTH_SIWE_DOMAIN: "localhost:3000", AUTH_SIWE_URI: "http://localhost:3000" }).settings.uri, "http://localhost:3000");
  for (const bad of [
    { AUTH_CHAIN_ID: "143" },
    { AUTH_SIWE_URI: "http://app.example.test" },
    { AUTH_SIWE_URI: "https://other.example.test" },
    { AUTH_PRIVY_VERIFICATION_KEY: "not a key" },
    { AUTH_PRIVY_APP_ID: "" },
    { AUTH_WALLET_SESSION_TTL_SECONDS: "0" },
  ]) {
    assert.throws(() => loadAuthConfig({ ...env, ...bad }), AuthConfigError);
  }
});
