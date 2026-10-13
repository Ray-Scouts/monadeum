import { AuthModule } from "@monadeum/auth";
import { RecoveryModule } from "@monadeum/recovery";
import { WalletsModule } from "@monadeum/wallets";
import { Module, type DynamicModule } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AgentsController } from "./agents.controller.js";
import { AuthController } from "./auth.controller.js";
import { EvidenceController } from "./evidence.controller.js";
import { FundingController } from "./funding.controller.js";
import { HealthController } from "./health.controller.js";
import { API_DEPENDENCIES, type ApiDependencies } from "./dependencies.js";
import { OperationsController } from "./operations.controller.js";
import { PolicyController } from "./policy.controller.js";
import { SessionGuard } from "./session.js";

/**
 * The API process (ARCHITECTURE.md section 10): AuthModule, WalletsModule (when configured), and RecoveryModule,
 * composed behind HTTP controllers. It has no agent loop. Rate limiting uses `@nestjs/throttler` with one named
 * throttler, `auth`, applied only to the sign-in, challenge, and link endpoints, with in-process storage.
 */
/** The public evidence endpoint's per-IP limit (proposed, not measured). */
export const PUBLIC_RATE_LIMIT = 60;
export const PUBLIC_RATE_WINDOW_MS = 60_000;

@Module({})
export class ApiModule {
  static forRoot(deps: ApiDependencies): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        AuthModule.forRoot(deps.auth),
        ...(deps.wallets ? [WalletsModule.forRoot(deps.wallets)] : []),
        RecoveryModule,
        ThrottlerModule.forRoot([
          { name: "auth", ttl: deps.settings.authRateWindowMs, limit: deps.settings.authRateLimit },
          { name: "public", ttl: PUBLIC_RATE_WINDOW_MS, limit: PUBLIC_RATE_LIMIT },
        ]),
      ],
      controllers: [HealthController, AuthController, AgentsController, FundingController, OperationsController, PolicyController, EvidenceController],
      providers: [{ provide: API_DEPENDENCIES, useValue: deps }, SessionGuard],
    };
  }
}

/** Process-level HTTP settings shared by `main.ts` and the tests: CORS for the web app's origin only, with credentials. */
export function configureApp(app: NestFastifyApplication, deps: ApiDependencies): NestFastifyApplication {
  app.enableCors({ origin: deps.settings.allowedOrigin, credentials: true, methods: ["GET", "POST"] });
  return app;
}
