import { MemoryChallengeStore, MemorySessionStore, MemoryUserStore } from "@monadeum/auth";
import { MemoryTickStore } from "@monadeum/tick";
import { MemoryTradeStore } from "@monadeum/trading";
import { MemoryAgentWalletStore, MemorySponsorshipLedger } from "@monadeum/wallets";
import { MemoryPaymentLog } from "@monadeum/x402";
import { conformance } from "./conformance.js";

conformance("memory", {
  async fresh() {
    return {
      wallets: new MemoryAgentWalletStore(),
      ledger: new MemorySponsorshipLedger(),
      users: new MemoryUserStore(),
      challenges: new MemoryChallengeStore(),
      sessions: new MemorySessionStore(),
      trades: new MemoryTradeStore(),
      payments: new MemoryPaymentLog(),
      ticks: new MemoryTickStore(),
    };
  },
});
