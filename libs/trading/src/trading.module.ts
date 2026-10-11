import { Module } from "@nestjs/common";
import { TradingService } from "./trading.js";

// The service needs deployment configuration (the market), a Venue with an RPC provider, a durable TradeStore and
// PositionStore, and a TradeSigner from the wallet layer (issue #24), so the consuming app constructs it:
// TradingModule.forRoot(service).
@Module({})
export class TradingModule {
  static forRoot(service: TradingService) {
    return { module: TradingModule, providers: [{ provide: TradingService, useValue: service }], exports: [TradingService] };
  }
}
