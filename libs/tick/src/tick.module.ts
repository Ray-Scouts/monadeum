import { Module } from "@nestjs/common";
import { StrategyModule } from "@monadeum/strategy";

@Module({
  imports: [StrategyModule],
  exports: [StrategyModule],
})
export class TickModule {}
