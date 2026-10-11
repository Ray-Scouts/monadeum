import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { PrivyTokenError, PrivyTokenVerifier, loadAuthConfig, privyJwksUrl, type FetchLike } from "../src/index.js";
import { APP_ID, PrivyIssuer, embedded } from "./privy-issuer.js";

// Verification against a published key set, offline: a stub fetch serves a local JWKS, and the tokens are checked
// by the installed @privy-io/node code with the key the cache selects by kid. The kids are arbitrary test labels.

const JWKS_URL = privyJwksUrl(APP_ID);

function jwksServer(initial: PrivyIssuer[]) {
  const state = { issuers: initial, calls: 0, up: true, status: 200 };
  const fetch: FetchLike = async (url, init) => {
    state.calls += 1;
    assert.equal(url, JWKS_URL);
    assert.equal(init.redirect, "error");
    if (!state.up) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ keys: state.issuers.map((issuer) => issuer.publicJwk) }), { status: state.status });
  };
  return { state, fetch };
}

function setup(issuers: PrivyIssuer[], options: { minFetchIntervalMs?: number } = {}) {
  const server = jwksServer(issuers);
  const clock = { now: 1_000_000 };
  const verifier = new PrivyTokenVerifier(APP_ID, null, { fetch: server.fetch, now: () => clock.now, ...options });
  return { server, clock, verifier };
}

const hs256 = (issuer: PrivyIssuer, payload: Record<string, unknown>) => {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const input = `${b64({ alg: "HS256", typ: "JWT", kid: issuer.kid })}.${b64(payload)}`;
  return `${input}.${createHmac("sha256", issuer.publicKeyPem).update(input).digest("base64url")}`;
};

test("the JWKS URL is Privy's per-app endpoint", () => {
  assert.equal(privyJwksUrl("cmv43cc5000st0fjpemxoc10r"), "https://auth.privy.io/api/v1/apps/cmv43cc5000st0fjpemxoc10r/jwks.json");
});

test("with two published keys, tokens signed by either verify, from one fetch", async () => {
  const a = new PrivyIssuer("kid-a");
  const b = new PrivyIssuer("kid-b");
  const { server, verifier } = setup([a, b]);
  assert.equal(verifier.keySource, "jwks");
  const session = await verifier.verifyAccessToken(a.accessToken("did:privy:alice"));
  assert.equal(session.privyUserId, "did:privy:alice");
  const identity = await verifier.verifyIdentityToken(b.identityToken("did:privy:alice", [embedded("0x1111111111111111111111111111111111111111")]));
  assert.equal(identity.privyUserId, "did:privy:alice");
  assert.equal(identity.embeddedWallets.length, 1);
  await verifier.verifyAccessToken(b.accessToken("did:privy:bob"));
  await verifier.verifyIdentityToken(a.identityToken("did:privy:bob", []));
  assert.equal(server.state.calls, 1);
});

test("an unknown kid triggers one refetch, then fails, and does not refetch again within the interval", async () => {
  const a = new PrivyIssuer("kid-a");
  const stranger = new PrivyIssuer("kid-unknown");
  const { server, clock, verifier } = setup([a]);
  await verifier.verifyAccessToken(a.accessToken("did:privy:alice"));
  assert.equal(server.state.calls, 1);
  clock.now += 61_000;
  await assert.rejects(verifier.verifyAccessToken(stranger.accessToken("did:privy:mallory")), PrivyTokenError);
  assert.equal(server.state.calls, 2);
  for (let i = 0; i < 5; i++) await assert.rejects(verifier.verifyAccessToken(stranger.accessToken("did:privy:mallory")), PrivyTokenError);
  assert.equal(server.state.calls, 2);
  // Known keys keep verifying from the cache.
  await verifier.verifyAccessToken(a.accessToken("did:privy:alice"));
  assert.equal(server.state.calls, 2);
});

test("a key rotated in at Privy verifies after the refetch its unknown kid causes", async () => {
  const a = new PrivyIssuer("kid-a");
  const next = new PrivyIssuer("kid-next");
  const { server, clock, verifier } = setup([a]);
  await verifier.verifyAccessToken(a.accessToken("did:privy:alice"));
  server.state.issuers = [next];
  clock.now += 61_000;
  const session = await verifier.verifyAccessToken(next.accessToken("did:privy:alice"));
  assert.equal(session.privyUserId, "did:privy:alice");
  assert.equal(server.state.calls, 2);
  // The withdrawn key is gone with the set it was in.
  await assert.rejects(verifier.verifyAccessToken(a.accessToken("did:privy:alice")), PrivyTokenError);
});

test("wrong algorithm, issuer, or audience, a missing kid, and expiry are refused", async () => {
  const a = new PrivyIssuer("kid-a");
  const { verifier } = setup([a]);
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: "privy.io", aud: APP_ID, sub: "did:privy:alice", sid: "s", iat, exp: iat + 3600 };
  const refused = [
    a.jwt(claims, { alg: "ES384", typ: "JWT", kid: "kid-a" }),
    hs256(a, claims),
    a.jwt(claims, { alg: "none", typ: "JWT", kid: "kid-a" }),
    a.jwt(claims, { alg: "ES256", typ: "JWT" }),
    a.accessToken("did:privy:alice", { iss: "not-privy.io" }),
    a.accessToken("did:privy:alice", { aud: "another-app" }),
    a.accessToken("did:privy:alice", { exp: iat - 60 }),
  ];
  for (const token of refused) await assert.rejects(verifier.verifyAccessToken(token), PrivyTokenError);
  await assert.rejects(verifier.verifyIdentityToken(a.identityToken("did:privy:alice", [], { aud: "another-app" })), PrivyTokenError);
  // The control: the same key and claims, correctly formed, verify.
  await verifier.verifyAccessToken(a.jwt(claims));
});

test("an unreachable or failing JWKS endpoint fails closed", async () => {
  const a = new PrivyIssuer("kid-a");
  for (const failure of [{ up: false }, { status: 503 }]) {
    const { server, verifier } = setup([a]);
    Object.assign(server.state, failure);
    await assert.rejects(verifier.verifyAccessToken(a.accessToken("did:privy:alice")), PrivyTokenError);
    await assert.rejects(verifier.verifyIdentityToken(a.identityToken("did:privy:alice", [])), PrivyTokenError);
  }
});

test("a cached set outlives a failed refresh only up to its maximum age, then verification fails closed", async () => {
  const a = new PrivyIssuer("kid-a");
  const { server, clock, verifier } = setup([a]);
  await verifier.verifyAccessToken(a.accessToken("did:privy:alice"));
  server.state.up = false;
  clock.now += 11 * 60_000; // past the refresh age, within the maximum age
  await verifier.verifyAccessToken(a.accessToken("did:privy:alice"));
  assert.equal(server.state.calls, 2);
  clock.now += 50 * 60_000; // past the maximum age
  await assert.rejects(verifier.verifyAccessToken(a.accessToken("did:privy:alice")), PrivyTokenError);
  server.state.up = true;
  clock.now += 61_000;
  await verifier.verifyAccessToken(a.accessToken("did:privy:alice"));
});

test("a malformed key set is not used", async () => {
  const a = new PrivyIssuer("kid-a");
  const fetch: FetchLike = async () => new Response(JSON.stringify({ keys: "nope" }), { status: 200 });
  const verifier = new PrivyTokenVerifier(APP_ID, null, { fetch });
  await assert.rejects(verifier.verifyAccessToken(a.accessToken("did:privy:alice")), PrivyTokenError);
});

test("a static verification key overrides the key set: only it verifies, and nothing is fetched", async () => {
  const pinned = new PrivyIssuer("kid-a");
  const other = new PrivyIssuer("kid-b");
  const server = jwksServer([pinned, other]);
  const verifier = new PrivyTokenVerifier(APP_ID, pinned.publicKeyPem, { fetch: server.fetch });
  assert.equal(verifier.keySource, "static");
  await verifier.verifyAccessToken(pinned.accessToken("did:privy:alice"));
  await assert.rejects(verifier.verifyAccessToken(other.accessToken("did:privy:alice")), PrivyTokenError);
  assert.equal(server.state.calls, 0);
});

test("configuration: the verification key is optional, and the app ID must be safe in a URL path", () => {
  const env = { AUTH_PRIVY_APP_ID: "cmv43cc5000st0fjpemxoc10r", AUTH_CHAIN_ID: "10143", AUTH_SIWE_DOMAIN: "app.example.test", AUTH_SIWE_URI: "https://app.example.test" };
  assert.equal(loadAuthConfig(env).privy.verificationKey, null);
  assert.equal(loadAuthConfig({ ...env, AUTH_PRIVY_VERIFICATION_KEY: "  " }).privy.verificationKey, null);
  assert.throws(() => loadAuthConfig({ ...env, AUTH_PRIVY_APP_ID: "../evil" }));
});
