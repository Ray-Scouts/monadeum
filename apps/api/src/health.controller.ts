import { Controller, Get, Inject } from "@nestjs/common";
import { API_DEPENDENCIES, type ApiDependencies } from "./dependencies.js";

/**
 * Liveness for a container healthcheck or a reverse proxy: the process is up and serving HTTP. Unauthenticated, so it
 * returns no data about any user or agent, only whether wallet operations are configured, which a client can already
 * tell from a 503 on deployment. It does not query the database; a database outage shows on the endpoints that use it.
 */
@Controller()
export class HealthController {
  constructor(@Inject(API_DEPENDENCIES) private readonly deps: ApiDependencies) {}

  @Get("health")
  health() {
    return { status: "ok", wallets: this.deps.wallets ? "configured" : "unavailable" };
  }
}
