import type { Principal, UserRecord } from "@monadeum/auth";
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { SkipThrottle, ThrottlerGuard } from "@nestjs/throttler";
import { API_DEPENDENCIES, fail, type ApiDependencies } from "./dependencies.js";
import {
  authStatus,
  Caller,
  checkOrigin,
  clearSessionCookie,
  sessionCookie,
  SessionGuard,
  setSessionCookie,
  type ApiReply,
  type ApiRequest,
} from "./session.js";

export interface UserView {
  id: string;
  ownerWallet: string | null;
  wallets: { address: string; kind: "embedded" | "external"; linkedAt: number }[];
  privyLinked: boolean;
  createdAt: number;
}

export function userView(user: UserRecord): UserView {
  return {
    id: user.id,
    ownerWallet: user.ownerWallet,
    wallets: user.wallets.map((w) => ({ address: w.address, kind: w.kind, linkedAt: w.linkedAt })),
    privyLinked: user.privyUserId !== null,
    createdAt: user.createdAt,
  };
}

function strings<K extends string>(body: unknown, ...keys: K[]): Record<K, string> {
  if (body === null || typeof body !== "object") fail(400, "invalid-body");
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value !== "string" || value.length === 0 || value.length > 8192) fail(400, "invalid-body", `${key} must be a non-empty string`);
    out[key] = value;
  }
  return out;
}

/**
 * AuthModule over HTTP (ARCHITECTURE.md section 10). Sign-in, challenge, and link endpoints are rate limited per
 * client IP by the `auth` throttler: a challenge costs a stored row and a sign-in costs signature recovery or token
 * verification, so both are the cheap way to load the service. Authentication only: nothing here authorizes an action.
 */
@Controller("auth")
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(@Inject(API_DEPENDENCIES) private readonly deps: ApiDependencies) {}

  /** Primary path. The client keeps its Privy access token and sends it as `Authorization: Bearer` afterwards. */
  @Post("privy/sign-in")
  @HttpCode(200)
  async privySignIn(@Body() body: unknown) {
    const { accessToken, identityToken } = strings(body, "accessToken", "identityToken");
    const result = await this.deps.auth.signInWithPrivy({ accessToken, identityToken });
    if (!result.ok) fail(authStatus(result.reason), result.reason);
    return { user: userView(result.user), created: result.created };
  }

  /** Secondary path: an EIP-4361 message for the wallet to sign. The server keeps the message; the client cannot alter it. */
  @Post("wallet/challenge")
  @HttpCode(200)
  async walletChallenge(@Body() body: unknown) {
    const { address } = strings(body, "address");
    const result = await this.deps.auth.walletChallenge({ address, purpose: "sign-in" });
    if (!result.ok) fail(authStatus(result.reason), result.reason);
    return { nonce: result.nonce, message: result.message, expiresAt: result.expiresAt };
  }

  /** Verifies the signed challenge and sets the session cookie. The token never appears in the body. */
  @Post("wallet/verify")
  @HttpCode(200)
  async walletVerify(@Body() body: unknown, @Req() req: ApiRequest, @Res({ passthrough: true }) reply: ApiReply) {
    // Sets a cookie, so it is held to the same origin rule as a cookie-authenticated request (login forgery).
    checkOrigin(this.deps, req);
    const { nonce, signature } = strings(body, "nonce", "signature");
    const result = await this.deps.auth.signInWithWallet({ nonce, signature });
    if (!result.ok) fail(authStatus(result.reason), result.reason);
    setSessionCookie(reply, result.sessionToken, this.deps.settings.sessionCookieMaxAgeMs);
    return { user: userView(result.user), created: result.created, expiresAt: result.principal.expiresAt };
  }

  @Post("wallet/link/challenge")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async linkChallenge(@Body() body: unknown, @Caller() principal: Principal) {
    const { address } = strings(body, "address");
    const result = await this.deps.auth.walletChallenge({ address, purpose: "link", principal });
    if (!result.ok) fail(authStatus(result.reason), result.reason);
    return { nonce: result.nonce, message: result.message, expiresAt: result.expiresAt };
  }

  /** Links an external wallet to the caller. Never changes the owner wallet. */
  @Post("wallet/link")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async linkWallet(@Body() body: unknown, @Caller() principal: Principal) {
    const { nonce, signature } = strings(body, "nonce", "signature");
    const result = await this.deps.auth.linkWallet({ principal, nonce, signature });
    if (!result.ok) fail(authStatus(result.reason), result.reason);
    return { user: userView(result.user) };
  }

  /** Links a Privy identity and its embedded wallets to the caller, for a user who started with an external wallet. */
  @Post("privy/link")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async linkPrivy(@Body() body: unknown, @Caller() principal: Principal) {
    const { accessToken, identityToken } = strings(body, "accessToken", "identityToken");
    const result = await this.deps.auth.linkPrivy({ principal, accessToken, identityToken });
    if (!result.ok) fail(authStatus(result.reason), result.reason);
    return { user: userView(result.user) };
  }

  /** Ends the external wallet session. A Privy session is ended by the client with Privy's SDK. */
  @Post("sign-out")
  @HttpCode(200)
  @SkipThrottle({ auth: true })
  async signOut(@Req() req: ApiRequest, @Res({ passthrough: true }) reply: ApiReply) {
    const token = sessionCookie(req);
    if (token) {
      checkOrigin(this.deps, req);
      await this.deps.auth.signOut(token);
    }
    clearSessionCookie(reply);
    return { signedOut: true };
  }

  @Get("me")
  @SkipThrottle({ auth: true })
  @UseGuards(SessionGuard)
  async me(@Caller() principal: Principal) {
    const user = await this.deps.auth.user(principal);
    if ("ok" in user) fail(authStatus(user.reason), user.reason);
    return { user: userView(user), via: principal.via, expiresAt: principal.expiresAt };
  }
}
