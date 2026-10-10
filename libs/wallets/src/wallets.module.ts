import { Module } from "@nestjs/common";
import { WalletsService } from "./wallets.service.js";

// The service needs a chain adapter, a durable store, a secrets-manager-backed key vault, and a sponsorship ledger,
// so the consuming app builds it: WalletsModule.forRoot(new WalletsService(...)). Per ARCHITECTURE.md section 10,
// AgentsModule is the only module that calls it to provision an account.
@Module({})
export class WalletsModule {
  static forRoot(service: WalletsService) {
    return { module: WalletsModule, providers: [{ provide: WalletsService, useValue: service }], exports: [WalletsService] };
  }
}
