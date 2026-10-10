import type { AuthFailureReason, Principal } from "@monadeum/auth";
import { createParamDecorator, Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { API_DEPENDENCIES, fail, type ApiDependencies } from "./dependencies.js";

/** The external wallet path's opaque session token travels only in this cookie, never in a response body. */
export const SESSION_COOKIE = "monadeum_session";

export interface ApiRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal;
}

export interface ApiReply {
  header(name: string, value: string): unknown;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const header = (req: ApiRequest, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

export function sessionCookie(req: ApiRequest): string | undefined {
  const raw = header(req, "cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim() || undefined;
  }
  return undefined;
}

/** `HttpOnly`, `Secure`, `SameSite=Strict`: unreadable by scripts, sent only over TLS, never on a cross-site request. */
export function setSessionCookie(reply: ApiReply, token: string, maxAgeMs: number) {
  reply.header("set-cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}`);
}

export function clearSessionCookie(reply: ApiReply) {
  reply.header("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

/** HTTP status for an AuthModule failure. */
export function authStatus(reason: AuthFailureReason): number {
  switch (reason) {
    case "invalid-address":
      return 400;
    case "guest-not-supported":
    case "no-owner-wallet":
      return 403;
    case "not-owner":
      return 404;
    case "identity-linked-elsewhere":
    case "wallet-linked-elsewhere":
    case "ambiguous-embedded-wallet":
    case "conflict":
      return 409;
    default:
      return 401;
  }
}

/**
 * A state-changing request authenticated by cookie must come from the web app's own origin. `SameSite=Strict`
 * already keeps the cookie off cross-site requests in current browsers; this check does not depend on that.
 */
export function checkOrigin(deps: ApiDependencies, req: ApiRequest) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;
  if (header(req, "origin") !== deps.settings.allowedOrigin) fail(403, "origin-not-allowed");
}

/**
 * Authenticates the caller, per request, and nothing more (THREAT-MODEL.md trust boundary 10). Two credentials are
 * accepted: a Privy access token as `Authorization: Bearer`, verified locally by AuthModule, or the external wallet
 * session cookie. A request carrying both is refused rather than resolved by precedence.
 */
export async function authenticate(deps: ApiDependencies, req: ApiRequest): Promise<Principal> {
  const authorization = header(req, "authorization");
  const cookie = sessionCookie(req);
  if (authorization && cookie) fail(401, "ambiguous-credentials");
  if (authorization) {
    const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(authorization);
    if (!match) fail(401, "invalid-token");
    const result = await deps.auth.authenticatePrivy(match[1]!);
    if (!result.ok) fail(401, result.reason);
    return result.principal;
  }
  if (cookie) {
    checkOrigin(deps, req);
    const result = await deps.auth.authenticateWalletSession(cookie);
    if (!result.ok) fail(401, result.reason);
    return result.principal;
  }
  fail(401, "unauthenticated");
}

/** Requires an authenticated caller and attaches the principal. Authorization is checked by each handler. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(API_DEPENDENCIES) private readonly deps: ApiDependencies) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    req.principal = await authenticate(this.deps, req);
    return true;
  }
}

/** The principal `SessionGuard` attached. */
export const Caller = createParamDecorator((_data: unknown, context: ExecutionContext): Principal => {
  const principal = context.switchToHttp().getRequest<ApiRequest>().principal;
  if (!principal) fail(401, "unauthenticated");
  return principal;
});
