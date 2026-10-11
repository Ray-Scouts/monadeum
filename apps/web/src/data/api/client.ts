import type {
  AgentDetailResponse,
  CreateAgentInput,
  ApiAgent,
  ApiUser,
  CapitalFlowResponse,
  HoldView,
  MeResponse,
  Operation,
  OwnerResponse,
  PopulationResponse,
  PresetsResponse,
  RevocationStatus,
  StopResponse,
  WalletChallenge,
} from "./types";

/**
 * How a request authenticates, matching the API's two credentials. A Privy session sends the access token as
 * `Authorization: Bearer` and never sends cookies, so a stale wallet session cookie cannot make the request ambiguous
 * (the API refuses a request carrying both). A wallet session sends only the `HttpOnly` cookie, which this code never
 * reads; the browser attaches it because the request is made with `credentials: "include"`.
 */
export type Credential = { via: "privy"; accessToken: () => Promise<string | null> } | { via: "wallet" };

/** A non-2xx answer, or no answer. `reason` is the API's stable `error` identifier, or `network-error`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    readonly detail: string | null = null,
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "ApiError";
  }
}

export const isApiError = (error: unknown, reason?: string): error is ApiError =>
  error instanceof ApiError && (reason === undefined || error.reason === reason);

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

interface SendOptions {
  credential?: Credential | null;
  body?: unknown;
  /** For the unauthenticated wallet endpoints: send and accept cookies. */
  cookies?: boolean;
}

export interface SessionClient {
  me(): Promise<MeResponse>;
  population(): Promise<PopulationResponse>;
  owner(): Promise<OwnerResponse>;
  agents(): Promise<{ agents: ApiAgent[] }>;
  agent(id: string): Promise<AgentDetailResponse>;
  capitalFlow(): Promise<CapitalFlowResponse>;
  presets(): Promise<PresetsResponse>;
  /** Creates an agent from a preset and starts its owner-signed deployment. Sends only the four fields the API accepts. */
  createAgent(input: CreateAgentInput): Promise<{ agent: ApiAgent; operation: Operation }>;
  /** "Stop this agent": revokes its session key. Answers 503 `wallets-unavailable` when the API has no vault. */
  stop(agentId: string): Promise<StopResponse>;
  revocation(agentId: string): Promise<RevocationStatus>;
  holds(): Promise<{ holds: HoldView[] }>;
  confirmHold(holdId: string, count: number): Promise<{ status: "waiting"; readyAt: number; hold: HoldView }>;
  releaseHold(holdId: string): Promise<StopResponse>;
  redeploy(agentId: string): Promise<{ operation: Operation }>;
  operation(id: string, wait: boolean): Promise<{ operation: Operation }>;
  /** Posts the owner wallet's signature. Only the signature leaves the browser, never a key. */
  submitSignature(operationId: string, requestId: string, signature: string): Promise<{ operation: Operation }>;
}

export interface ApiClient {
  baseUrl: string;
  privySignIn(accessToken: string, identityToken: string): Promise<{ user: ApiUser; created: boolean }>;
  walletChallenge(address: string): Promise<WalletChallenge>;
  /** Sets the `monadeum_session` cookie. The token is never in the body and never readable here. */
  walletVerify(nonce: string, signature: string): Promise<{ user: ApiUser; created: boolean; expiresAt: number }>;
  /** Ends a wallet session and clears its cookie. A Privy session is ended with Privy's SDK. */
  signOut(): Promise<{ signedOut: boolean }>;
  as(credential: Credential): SessionClient;
}

const seg = (value: string) => encodeURIComponent(value);

export function createApiClient(baseUrl: string, fetchImpl: Fetch = (input, init) => fetch(input, init)): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");

  async function send<T>(method: "GET" | "POST", path: string, options: SendOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    let credentials: RequestCredentials = options.cookies ? "include" : "omit";
    const credential = options.credential;
    if (credential?.via === "privy") {
      const token = await credential.accessToken();
      if (!token) throw new ApiError(401, "unauthenticated", "no Privy access token");
      headers.authorization = `Bearer ${token}`;
      credentials = "omit";
    } else if (credential?.via === "wallet") {
      credentials = "include";
    }
    let body: string | undefined;
    if (method === "POST") {
      // Fastify refuses an empty body declared as JSON, so a POST always carries an object.
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body ?? {});
    }
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, { method, headers, body, credentials, mode: "cors", cache: "no-store" });
    } catch (error) {
      throw new ApiError(0, "network-error", error instanceof Error ? error.message : null);
    }
    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!response.ok) {
      const b = (json ?? {}) as { error?: unknown; detail?: unknown };
      const reason = typeof b.error === "string" && /^[a-z0-9-]{1,64}$/.test(b.error) ? b.error : `http-${response.status}`;
      throw new ApiError(response.status, reason, typeof b.detail === "string" ? b.detail : null);
    }
    return json as T;
  }

  return {
    baseUrl: base,
    privySignIn: (accessToken, identityToken) => send("POST", "/auth/privy/sign-in", { body: { accessToken, identityToken } }),
    walletChallenge: (address) => send("POST", "/auth/wallet/challenge", { body: { address } }),
    walletVerify: (nonce, signature) => send("POST", "/auth/wallet/verify", { body: { nonce, signature }, cookies: true }),
    signOut: () => send("POST", "/auth/sign-out", { cookies: true }),
    as(credential) {
      const get = <T,>(path: string) => send<T>("GET", path, { credential });
      const post = <T,>(path: string, body?: unknown) => send<T>("POST", path, { credential, body });
      return {
        me: () => get("/auth/me"),
        population: () => get("/population"),
        owner: () => get("/owners/me"),
        agents: () => get("/agents"),
        agent: (id) => get(`/agents/${seg(id)}`),
        capitalFlow: () => get("/capital-flow"),
        presets: () => get("/genome/presets"),
        createAgent: ({ name, perTxCap, dailyCap, preset }) => post("/agents", preset === undefined ? { name, perTxCap, dailyCap } : { name, perTxCap, dailyCap, preset }),
        stop: (id) => post(`/agents/${seg(id)}/stop`),
        revocation: (id) => get(`/agents/${seg(id)}/revocation`),
        holds: () => get("/recovery/holds"),
        confirmHold: (id, count) => post(`/recovery/holds/${seg(id)}/confirm`, { count }),
        releaseHold: (id) => post(`/recovery/holds/${seg(id)}/release`),
        redeploy: (id) => post(`/agents/${seg(id)}/deploy`),
        operation: (id, wait) => get(`/operations/${seg(id)}${wait ? "?wait=true" : ""}`),
        submitSignature: (id, requestId, signature) => post(`/operations/${seg(id)}/signature`, { requestId, signature }),
      };
    },
  };
}
