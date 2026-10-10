import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service.js";

// The service needs a Privy verifier, durable user, challenge, and session stores, and the owner wallet handoff that
// AgentsModule implements, so the consuming app builds it: AuthModule.forRoot(new AuthService(...)).
@Module({})
export class AuthModule {
  static forRoot(service: AuthService) {
    return { module: AuthModule, providers: [{ provide: AuthService, useValue: service }], exports: [AuthService] };
  }
}
