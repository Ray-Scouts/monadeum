import { Module } from "@nestjs/common";
import { RecoveryService } from "./recovery.service.js";

@Module({
  providers: [RecoveryService],
  exports: [RecoveryService],
})
export class RecoveryModule {}
