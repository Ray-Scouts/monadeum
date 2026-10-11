// Opt-in smoke run of the web's API client against a running `apps/api` (see apps/web/README.md). Not part of
// `bun run test`: it needs a live API process. Signs in on the external wallet path with a throwaway key generated
// here, so no Privy app and no real wallet are involved.
//
//   SMOKE_API_URL=http://127.0.0.1:3901 SMOKE_ORIGIN=http://localhost:3000 bun scripts/smoke-api.ts

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ApiError, createApiClient } from "../src/data/api/client";
import { stopViewFromError } from "../src/data/api/stop";

const base = process.env.SMOKE_API_URL;
const origin = process.env.SMOKE_ORIGIN;
if (!base || !origin) throw new Error("set SMOKE_API_URL and SMOKE_ORIGIN (the API's AUTH_SIWE_URI)");

// A browser keeps the HttpOnly cookie and sends Origin itself; outside a browser this jar does both.
let cookie: string | null = null;
const jarFetch = async (url: string, init: RequestInit) => {
  const headers = { ...(init.headers as Record<string, string>), origin };
  if (cookie && init.credentials === "include") headers.cookie = cookie;
  const response = await fetch(url, { ...init, headers });
  const set = response.headers.get("set-cookie");
  if (set) {
    const pair = set.split(";")[0]!;
    cookie = pair.endsWith("=") ? null : pair;
  }
  return response;
};

const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

const api = createApiClient(base, jarFetch);
const owner = privateKeyToAccount(generatePrivateKey());

const challenge = await api.walletChallenge(owner.address);
await api.walletVerify(challenge.nonce, await owner.signMessage({ message: challenge.message }));
check("wallet sign-in sets the session cookie", cookie !== null);

const session = api.as({ via: "wallet" });
const me = await session.me();
check("GET /auth/me through the cookie", me.via === "wallet" && me.user.ownerWallet === owner.address, me.user.ownerWallet ?? "no owner wallet");

const population = await session.population();
check("GET /population", typeof population.agents === "number", JSON.stringify(population));

const agents = await session.agents();
check("GET /agents", Array.isArray(agents.agents), `${agents.agents.length} agents`);

const flow = await session.capitalFlow();
check("GET /capital-flow says reallocations are not indexed", flow.reallocationsIndexed === false && flow.reallocations.length === 0);

const ownerView = await session.owner();
check("GET /owners/me", ownerView.rootWallet === owner.address && ownerView.policy === null);

const presets = await session.presets();
check("GET /genome/presets", presets.presets.some((p) => p.name === presets.default), `default ${presets.default}, pair ${presets.pair}`);

const created = await session.createAgent({ name: "smoke", perTxCap: "1000", dailyCap: "2000", preset: presets.default }).catch((e: unknown) => e);
check("POST /agents without a vault answers 503 and creates nothing", created instanceof ApiError && created.status === 503, created instanceof ApiError ? created.reason : "created");
check("no agent was created", (await session.agents()).agents.length === 0);

const stop = await session.stop("smoke-agent").catch((e: unknown) => e);
check("POST /agents/:id/stop without a vault answers 503", stop instanceof ApiError && stop.status === 503, stop instanceof ApiError ? stop.reason : String(stop));
check("the stop control shows the unavailable message", stopViewFromError(stop).state === "unavailable");

await api.signOut();
const after = await session.me().catch((e: unknown) => e);
check("after sign-out the session is refused", after instanceof ApiError && after.status === 401);
