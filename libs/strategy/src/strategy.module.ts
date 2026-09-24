import { Module } from "@nestjs/common";
import { StrategyService } from "./strategy.service.js";

@Module({
  providers: [StrategyService],
  exports: [StrategyService],
})
export class StrategyModule {}
