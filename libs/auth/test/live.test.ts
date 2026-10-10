import assert from "node:assert/strict";
import { test } from "node:test";
import { PrivyTokenVerifier, loadAuthConfig } from "../src/index.js";

// Opt-in check against a real Privy app: verifies an access token and an identity token that Privy issued to a
// logged-in user, with the app ID and verification key from configuration. Skipped unless AUTH_PRIVY_LIVE=1.
// Needs every variable loadAuthConfig reads, plus AUTH_PRIVY_LIVE_ACCESS_TOKEN and AUTH_PRIVY_LIVE_IDENTITY_TOKEN,
// copied from a testnet session in the browser. Both expire; neither is a secret worth keeping, but do not commit
// them. Nothing here calls Privy's API or uses the app secret.

const enabled = process.env.AUTH_PRIVY_LIVE === "1";

test("live: Privy-issued tokens verify locally and name the same user", { skip: !enabled && "set AUTH_PRIVY_LIVE=1 to run" }, async () => {
  const config = loadAuthConfig();
  const accessToken = process.env.AUTH_PRIVY_LIVE_ACCESS_TOKEN;
  const identityToken = process.env.AUTH_PRIVY_LIVE_IDENTITY_TOKEN;
  if (!accessToken || !identityToken) throw new Error("AUTH_PRIVY_LIVE_ACCESS_TOKEN and AUTH_PRIVY_LIVE_IDENTITY_TOKEN must be set");
  const verifier = new PrivyTokenVerifier(config.privy.appId, config.privy.verificationKey);
  const session = await verifier.verifyAccessToken(accessToken);
  const identity = await verifier.verifyIdentityToken(identityToken);
  assert.equal(identity.privyUserId, session.privyUserId);
  assert.match(session.privyUserId, /^did:privy:/);
  console.log(`verified ${session.privyUserId}: ${identity.embeddedWallets.length} embedded Ethereum wallet(s), guest ${identity.isGuest}`);
});
