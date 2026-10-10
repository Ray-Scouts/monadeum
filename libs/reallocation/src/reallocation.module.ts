import { Module } from "@nestjs/common";
import { NoPolicies, UnconfiguredSettlement } from "./ports.js";
import { ReallocationService } from "./reallocation.service.js";

/**
 * Owner-scoped reallocation and section 6 retirement (EVOLUTION.md sections 3 and 6). With no policy source and no
 * settlement configured, it plans nothing and can submit nothing: reallocation is off by default.
 */
@Module({
  providers: [
    {
      provide: ReallocationService,
      useFactory: () => new ReallocationService(new NoPolicies(), new UnconfiguredSettlement()),
    },
  ],
  exports: [ReallocationService],
})
export class ReallocationModule {}
