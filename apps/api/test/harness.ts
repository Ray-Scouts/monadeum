import "reflect-metadata";
import { PGlite } from "@electric-sql/pglite";
import { PrivyTokenError, type AuthSettings, type PrivyIdentity, type PrivySession, type PrivyVerifier } from "@monadeum/auth";
import type { ReallocationPolicyWriter } from "@monadeum/commitment";
import { migrate, pgliteDatabase, PgReadModelStore, type Database } from "@monadeum/db";
import { REALLOCATION_ENABLED } from "@monadeum/reallocation/switch";
import type { ChainEvent, ReadModelStore } from "@monadeum/indexer";
import { buildScope, MemorySessionKeyVault, WalletsService, type OwnerSigner } from "@monadeum/wallets";
import { FakeChain } from "@monadeum/wallets/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { getAddress, keccak256, toHex, verifyMessage, verifyTypedData, type Address, type Hex, type LocalAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ApiModule, buildDependencies, configureApp, memoryStores, postgresStores, roleScoped, type ApiDependencies, type ApiSettings, type ApiStores, type FundingChain, type FundingSettings } from "../src/index.js";

export const ORIGIN = "https://app.example.test";

export const authSettings: AuthSettings = { chainId: 10143, domain: "app.example.test", uri: ORIGIN, challengeTtlMs: 300_000, walletSessionTtlMs: 3_600_000 };

export function settings(overrides: Partial<ApiSettings> = {}): ApiSettings {
  return {
    allowedOrigin: ORIGIN,
    chainId: 10143,
    authRateLimit: 1000,
    authRateWindowMs: 60_000,
    signatureTimeoutMs: 30_000,
    operationWaitMs: 2_000,
    sessionCookieMaxAgeMs: 3_600_000,
    maxPerTxCap: 1_000_000_000n,
    maxDailyCap: 5_000_000_000n,
    settlementDecimals: 6,
    agentPair: "WETH/USDC",
    populationCap: 50,
    reallocationContract: "0x000000000000000000000000000000000000A110",
    // On here, so the policy tests exercise the endpoint; the process default is off (loadApiConfig).
    reallocation: REALLOCATION_ENABLED,
    ...overrides,
  };
}

/** A fake Privy access token for `did`, in a JWT's character set. */
export const accessToken = (did: string) => `access.${Buffer.from(did).toString("base64url")}`;

/**
 * A stand-in for Privy's verifier. Access tokens come from `accessToken(did)`, identity tokens are
 * `identity:<did>:<address>` or `identity:<did>:<address>:guest`. AuthModule's own tests exercise the real `@privy-io/node` verification; these
 * tests are about what the API does with a verified or refused token.
 */
export class FakePrivy implements PrivyVerifier {
  async verifyAccessToken(token: string): Promise<PrivySession> {
    const m = /^access\.([A-Za-z0-9_-]+)$/.exec(token);
    const did = m ? Buffer.from(m[1]!, "base64url").toString() : "";
    if (!/^did:privy:[a-z0-9]+$/.test(did)) throw new PrivyTokenError("access token rejected");
    return { privyUserId: did, sessionId: `s-${did}`, expiresAt: Math.floor(Date.now() / 1000) + 86_400 };
  }

  async verifyIdentityToken(token: string): Promise<PrivyIdentity> {
    const m = /^identity:(did:privy:[a-z0-9]+):(0x[0-9a-fA-F]{40})(:guest)?$/.exec(token);
    if (!m) throw new PrivyTokenError("identity token rejected");
    return { privyUserId: m[1]!, isGuest: Boolean(m[3]), embeddedWallets: [getAddress(m[2]!)] };
  }
}

/**
 * WalletsModule's test chain, made to require the owner's signature the way Kernel does: every owner operation asks
 * the owner signer for an EIP-191 signature over an operation hash, and is refused, like a bundler simulation would,
 * unless that signature recovers to the owner. The base FakeChain never calls the signer.
 */
export class SigningFakeChain extends FakeChain {
  ownerSignatures = 0;

  override async prepareOwnerOperation(input: Parameters<FakeChain["prepareOwnerOperation"]>[0]) {
    const hash = keccak256(toHex(`owner-op:${input.account}:${this.ownerSignatures}:${JSON.stringify(input.calls, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`));
    const signature = await (input.owner.signer as LocalAccount).signMessage({ message: { raw: hash } });
    if (!(await verifyMessage({ address: input.owner.address, message: { raw: hash }, signature }))) throw new Error("AA24 signature error");
    this.ownerSignatures++;
    return super.prepareOwnerOperation(input);
  }

  /**
   * Session approval as Kernel v3.1 asks for it: the owner signs EIP-712 typed data in the account's domain, bound to
   * the account's current nonce. Refused unless the signature recovers to the owner.
   */
  override async approveSession(input: Parameters<FakeChain["approveSession"]>[0]) {
    const approval = await super.approveSession(input);
    const typedData = {
      domain: { name: "Kernel", version: "0.3.1", chainId: 10143, verifyingContract: input.account },
      types: { Enable: [{ name: "validationId", type: "bytes21" }, { name: "nonce", type: "uint32" }, { name: "hook", type: "address" }, { name: "validatorData", type: "bytes" }, { name: "hookData", type: "bytes" }, { name: "selectorData", type: "bytes" }] },
      primaryType: "Enable" as const,
      message: { validationId: `0x02${input.sessionKeyAddress.slice(2)}` as Hex, nonce: approval.enableNonce, hook: "0x00000000000000000000000000000000000000f0" as Address, validatorData: "0x" as Hex, hookData: "0x00" as Hex, selectorData: "0x" as Hex },
    };
    const signature = await (input.owner.signer as LocalAccount).signTypedData(typedData);
    if (!(await verifyTypedData({ ...typedData, address: input.owner.address, signature }))) throw new Error("enable signature does not recover to the owner");
    this.ownerSignatures++;
    return { ...approval, enableSignature: signature };
  }
}

const USDC = getAddress("0x00000000000000000000000000000000000000a1");
const ROUTER = getAddress("0x00000000000000000000000000000000000000b1");
const REALLOC = getAddress("0x00000000000000000000000000000000000000c1");
export const scope = buildScope({ settlementAsset: USDC, kuruRouter: ROUTER, kuruRouterSelectors: ["0x12345678"], reallocation: REALLOC, reallocationSelectors: ["0x9abcdef0"] });

export interface Booted {
  app: NestFastifyApplication;
  deps: ApiDependencies;
  stores: ApiStores;
  chain: SigningFakeChain;
  vault: MemorySessionKeyVault;
  clock: { now: number };
  /** Writes chain facts as the indexer would, through `monadeum_indexer` on Postgres. */
  indexer: ReadModelStore;
  /** The owning connection, on Postgres only. */
  db: Database | null;
  close(): Promise<void>;
}

export type Backend = "memory" | "pglite";

export async function boot(backend: Backend, options: { settings?: Partial<ApiSettings>; wallets?: boolean; policyWriter?: ReallocationPolicyWriter; funding?: (chain: SigningFakeChain, clock: { now: number }) => { chain: FundingChain; settings: FundingSettings } } = {}): Promise<Booted> {
  let pg: PGlite | null = null;
  let db: Database | null = null;
  let stores: ApiStores;
  let indexer: ReadModelStore;
  if (backend === "pglite") {
    pg = new PGlite();
    db = pgliteDatabase(pg);
    await migrate(db);
    stores = postgresStores(db);
    indexer = new PgReadModelStore(roleScoped(db, "monadeum_indexer"));
  } else {
    stores = memoryStores();
    indexer = stores.readModel;
  }
  const clock = { now: Date.now() };
  const chain = new SigningFakeChain();
  const vault = new MemorySessionKeyVault();
  const deps = buildDependencies({
    stores,
    privy: new FakePrivy(),
    authSettings,
    settings: settings(options.settings),
    wallets: options.wallets === false ? null : (s) => new WalletsService(chain, s.walletStore, vault, s.ledger, { scope, budget: { operations: 100, gasWei: 10n ** 18n }, paymaster: true }, () => clock.now),
    policyWriter: options.policyWriter ?? null,
    funding: options.funding ? options.funding(chain, clock) : null,
    now: () => clock.now,
  });
  const moduleRef = await Test.createTestingModule({ imports: [ApiModule.forRoot(deps)] }).compile();
  const app = configureApp(moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false }), deps);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app, deps, stores, chain, vault, clock, indexer, db,
    async close() {
      await app.close();
      await pg?.close();
    },
  };
}

export type Credential = { bearer: string } | { cookie: string } | { bearer: string; cookie: string } | null;

export interface Reply {
  status: number;
  body: any;
  headers: Record<string, unknown>;
}

/** One request. A POST carries the web app's Origin unless `origin` says otherwise. */
export async function call(app: NestFastifyApplication, method: "GET" | "POST", url: string, input: { auth?: Credential; body?: unknown; origin?: string | null } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  const auth = input.auth;
  if (auth && "bearer" in auth) headers.authorization = `Bearer ${auth.bearer}`;
  if (auth && "cookie" in auth) headers.cookie = `monadeum_session=${auth.cookie}`;
  const origin = input.origin === undefined ? (method === "POST" ? ORIGIN : null) : input.origin;
  if (origin) headers.origin = origin;
  const res = await app.inject({ method, url, headers, ...(input.body !== undefined ? { payload: input.body as object } : {}) });
  let body: unknown = null;
  try {
    body = res.body ? JSON.parse(res.body) : null;
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body, headers: res.headers };
}

export const newWallet = (): PrivateKeyAccount => privateKeyToAccount(generatePrivateKey());

/** Signs in through the external wallet path and returns the session cookie value. */
export async function walletSignIn(app: NestFastifyApplication, account: PrivateKeyAccount): Promise<{ cookie: string; userId: string }> {
  const challenge = await call(app, "POST", "/auth/wallet/challenge", { body: { address: account.address } });
  if (challenge.status !== 200) throw new Error(`challenge ${challenge.status} ${JSON.stringify(challenge.body)}`);
  const signature = await account.signMessage({ message: challenge.body.message });
  const verified = await call(app, "POST", "/auth/wallet/verify", { body: { nonce: challenge.body.nonce, signature } });
  if (verified.status !== 200) throw new Error(`verify ${verified.status} ${JSON.stringify(verified.body)}`);
  const setCookie = String(verified.headers["set-cookie"]);
  const cookie = /monadeum_session=([^;]+)/.exec(setCookie)![1]!;
  return { cookie, userId: verified.body.user.id };
}

/** Signs in through Privy with an embedded wallet whose key the test holds, standing in for Privy's wallet. */
export async function privySignIn(app: NestFastifyApplication, did: string, embedded: PrivateKeyAccount): Promise<{ bearer: string; userId: string }> {
  const res = await call(app, "POST", "/auth/privy/sign-in", { body: { accessToken: accessToken(did), identityToken: `identity:${did}:${embedded.address}` } });
  if (res.status !== 200) throw new Error(`privy sign-in ${res.status} ${JSON.stringify(res.body)}`);
  return { bearer: accessToken(did), userId: res.body.user.id };
}

/** What the owner's wallet does with a signature request: sign exactly what the API returned. */
export async function signRequest(account: PrivateKeyAccount, request: any): Promise<Hex> {
  if (request.kind === "message") return account.signMessage({ message: request.message });
  const td = request.typedData;
  const fields: { name: string; type: string }[] = td.types[td.primaryType];
  const message: Record<string, unknown> = { ...td.message };
  for (const f of fields) if (/^u?int\d*$/.test(f.type)) message[f.name] = BigInt(message[f.name] as string);
  return account.signTypedData({ domain: td.domain, types: td.types, primaryType: td.primaryType, message } as any);
}

/** Answers every signature request of an operation with `account` until it finishes. */
export async function signThrough(app: NestFastifyApplication, auth: Credential, operation: any, account: PrivateKeyAccount): Promise<any> {
  let op = operation;
  for (let i = 0; i < 10 && (op.status === "awaiting-signature" || op.status === "running"); i++) {
    if (op.status === "running") {
      op = (await call(app, "GET", `/operations/${op.id}?wait=true`, { auth })).body.operation;
      continue;
    }
    const signature = await signRequest(account, op.signatureRequest);
    const res = await call(app, "POST", `/operations/${op.id}/signature`, { auth, body: { requestId: op.signatureRequest.id, signature } });
    if (res.status !== 200) throw new Error(`signature ${res.status} ${JSON.stringify(res.body)}`);
    op = res.body.operation;
  }
  return op;
}

/** Creates and deploys an agent through the API, signing the deployment with the owner's wallet. */
export async function createAgent(app: NestFastifyApplication, auth: Credential, owner: PrivateKeyAccount, name = "alpha") {
  const res = await call(app, "POST", "/agents", { auth, body: { name, perTxCap: "1000000", dailyCap: "5000000" } });
  if (res.status !== 202) throw new Error(`create ${res.status} ${JSON.stringify(res.body)}`);
  const op = await signThrough(app, auth, res.body.operation, owner);
  if (op.status !== "succeeded" || !op.result.ok) throw new Error(`deploy ${JSON.stringify(op)}`);
  return { agentId: res.body.agent.id as string, account: op.result.account as Address };
}

/** Issues the agent's session key directly with the owner's own signer, for tests about other flows; the API path is `POST /agents/:id/activate`. */
export async function issueKey(booted: Booted, agentId: string, owner: PrivateKeyAccount) {
  const signer: OwnerSigner = { address: owner.address, signer: owner };
  const issued = await booted.deps.wallets!.issueSessionKey({ agentId, owner: signer });
  if (!issued.ok) throw new Error(`issue ${JSON.stringify(issued)}`);
  return issued;
}

let block = 1000n;

/** Indexes chain facts about an account, as the indexer would after a finalized batch. */
export async function index(booted: Booted, account: Address, facts: { kind: string; data: ChainEvent["data"] }[]) {
  const n = ++block;
  const hash = keccak256(toHex(`block-${n}`));
  const events: ChainEvent[] = facts.map((f, i) => ({
    kind: f.kind,
    account: account.toLowerCase() as Address,
    address: "0x00000000000000000000000000000000000000f0",
    blockNumber: n,
    blockHash: hash,
    transactionHash: keccak256(toHex(`tx-${n}-${i}`)),
    logIndex: i,
    data: f.data,
  }));
  await booted.indexer.apply({ events, blocks: [{ number: n, hash }], discovered: [{ account: account.toLowerCase() as Address, firstBlock: n }], cursor: { number: n, hash }, pruneBelow: 0n });
}
