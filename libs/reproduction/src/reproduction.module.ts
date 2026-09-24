import { Module } from "@nestjs/common";
import { ReproductionService } from "./reproduction.service.js";
import { UnconfiguredSettlement } from "./settlement.js";

@Module({
  providers: [UnconfiguredSettlement, { provide: ReproductionService, useFactory: () => new ReproductionService(new UnconfiguredSettlement()) }],
  exports: [ReproductionService],
})
export class ReproductionModule {}
