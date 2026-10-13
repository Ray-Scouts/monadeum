import { Controller, Get, Inject, Res, UseGuards } from "@nestjs/common";
import { SkipThrottle, ThrottlerGuard } from "@nestjs/throttler";
import { API_DEPENDENCIES, type ApiDependencies } from "./dependencies.js";
import { buildEvidence } from "./evidence.js";
import type { ApiReply } from "./session.js";

/**
 * The public evidence endpoint (ARCHITECTURE.md section 10). Unauthenticated and read-only. It is rate limited per
 * client IP by the `public` throttler and is exempt from the `auth` one, which exists for the sign-in endpoints.
 */
@Controller("public")
@UseGuards(ThrottlerGuard)
@SkipThrottle({ auth: true })
export class EvidenceController {
  constructor(@Inject(API_DEPENDENCIES) private readonly deps: ApiDependencies) {}

  @Get("evidence")
  async evidence(@Res({ passthrough: true }) reply: ApiReply) {
    reply.header("cache-control", "public, max-age=15, stale-while-revalidate=30");
    return buildEvidence(this.deps);
  }
}
