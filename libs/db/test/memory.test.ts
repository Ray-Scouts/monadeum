import { MemoryAgentStore, MemoryDebitStore, MemoryEvaluationStore } from "@monadeum/agent-registry";
import { MemoryChallengeStore, MemorySessionStore, MemoryUserStore } from "@monadeum/auth";
import { InMemoryReadModelStore } from "@monadeum/read-model";
import { MemoryTickStore } from "@monadeum/tick";
import { MemoryPositionStore, MemoryTradeStore } from "@monadeum/trading";
import { MemoryAgentWalletStore, MemorySponsorshipLedger } from "@monadeum/wallets";
import { MemoryPaymentLog, MemoryX402SlotStore } from "@monadeum/x402";
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
      slots: new MemoryX402SlotStore(),
      ticks: new MemoryTickStore(),
      readModel: new InMemoryReadModelStore(),
      agents: new MemoryAgentStore(),
      debits: new MemoryDebitStore(),
      positions: new MemoryPositionStore(),
      evaluations: new MemoryEvaluationStore(),
    };
  },
});
