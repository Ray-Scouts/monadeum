import { Module } from "@nestjs/common";
import { FitnessService } from "./fitness.service.js";

@Module({
  providers: [FitnessService],
  exports: [FitnessService],
})
export class FitnessModule {}
