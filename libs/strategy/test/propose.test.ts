import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { StrategyService } from "../src/strategy.service.js";

const base = {
  capital: 100,
  riskTolerance: 0.25,
  executionFrequency: 1,
  informationBudget: 1,
  pair: "PAIR_A",
  ticksSinceTrade: 1,
  signal: 0.01,
};

test("notional respects the legal risk ceiling and frequency floor", () => {
  const service = new StrategyService();
  const action = service.propose({ ...base, riskTolerance: 1 }, null);
  assert.equal(action?.notional, 25);
  assert.throws(() => service.propose({ ...base, executionFrequency: 0 }, null));
  assert.equal(service.propose({ ...base, ticksSinceTrade: 0, executionFrequency: 5 }, null), null);
});

test("information is bought only when its expected edge clears the price", () => {
  const service = new StrategyService();
  const cheap = service.propose(base, { provider: "nansen", price: 0.01 });
  const expensive = service.propose(base, { provider: "nansen", price: 0.2 });
  const unknown = service.propose(base, { provider: "random", price: 0.01 });
  assert.equal(cheap?.buyInformation, true);
  assert.equal(expensive?.buyInformation, false);
  assert.equal(unknown?.buyInformation, false);
});

test("the strategy package does not depend on wallets or policy", () => {
  const path = fileURLToPath(new URL("../../package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(path, "utf8")) as { dependencies?: Record<string, string> };
  const names = Object.keys(pkg.dependencies ?? {});
  assert.deepEqual(names, ["@nestjs/common"]);
});
