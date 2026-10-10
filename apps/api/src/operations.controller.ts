import type { Principal } from "@monadeum/auth";
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { API_DEPENDENCIES, fail, type ApiDependencies } from "./dependencies.js";
import { Caller, SessionGuard } from "./session.js";

/**
 * The client side of the signature relay. An owner-signed operation (deployment, revocation, policy) responds with
 * `status: "awaiting-signature"` and a `signatureRequest`; the owner's wallet signs it, and the client posts the
 * signature here. The response is the operation's next state: another request, `running`, or its outcome. An
 * operation is visible only to the user who started it.
 */
@Controller("operations")
@UseGuards(SessionGuard)
export class OperationsController {
  constructor(@Inject(API_DEPENDENCIES) private readonly deps: ApiDependencies) {}

  /** `?wait=true` holds the request until the next signature request or the end, bounded by the operation wait. */
  @Get(":id")
  async get(@Param("id") id: string, @Query("wait") wait: string | undefined, @Caller() principal: Principal) {
    const view = wait === "true" ? await this.deps.relay.wait(id, principal.userId) : this.deps.relay.view(id, principal.userId);
    if (!view) fail(404, "not-found");
    return { operation: view };
  }

  @Post(":id/signature")
  @HttpCode(200)
  async sign(@Param("id") id: string, @Body() body: unknown, @Caller() principal: Principal) {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.requestId !== "string" || typeof b.signature !== "string") fail(400, "invalid-body", "requestId and signature are required");
    const result = await this.deps.relay.submit({ id, userId: principal.userId, requestId: b.requestId, signature: b.signature });
    if (!result.ok) fail(result.reason === "not-found" ? 404 : result.reason === "bad-signature" ? 400 : 409, result.reason);
    return { operation: result.view };
  }
}
