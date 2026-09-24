import assert from "node:assert/strict";
import { test } from "node:test";
import { RecoveryService } from "../src/recovery.service.js";
import { RECOVERY_DELAY_MS, RECOVERY_WINDOW_MS, decideRecovery, type PriorRecovery } from "../src/decide.js";

const root = "wallet-root";
const hour = RECOVERY_WINDOW_MS;

test("one agent executes immediately and a later agent an hour on still executes", () => {
  const service = new RecoveryService();
  const first = service.request({ rootWalletId: root, agentIds: ["a"], kind: "revoke", now: 0, priors: [] });
  assert.equal(first.outcome, "execute");
  const later = service.request({
    rootWalletId: root,
    agentIds: ["b"],
    kind: "revoke",
    now: hour + 1,
    priors: [{ rootWalletId: root, agentId: "a", at: 0 }],
  });
  assert.equal(later.outcome, "execute");
});

test("three agents inside the hour execute and the fourth is held", () => {
  const priors: PriorRecovery[] = [
    { rootWalletId: root, agentId: "a", at: 1_000 },
    { rootWalletId: root, agentId: "b", at: 2_000 },
  ];
  const third = decideRecovery({ rootWalletId: root, agentIds: ["c"], kind: "sweep", now: 3_000, priors });
  assert.equal(third.outcome, "execute");
  const fourth = decideRecovery({
    rootWalletId: root,
    agentIds: ["d"],
    kind: "sweep",
    now: 4_000,
    priors: [...priors, { rootWalletId: root, agentId: "c", at: 3_000 }],
  });
  assert.equal(fourth.outcome, "hold");
  if (fourth.outcome === "hold") assert.deepEqual(fourth.hold.agentIds, ["d"]);
});

test("a request that names two agents is held even when the window is empty", () => {
  const decision = decideRecovery({ rootWalletId: root, agentIds: ["a", "b"], kind: "sweep", now: 10, priors: [] });
  assert.equal(decision.outcome, "hold");
});

test("a held bulk action executes only after the stated count and the delay", () => {
  const service = new RecoveryService();
  const held = service.request({ rootWalletId: root, agentIds: ["a", "b", "c"], kind: "revoke", now: 0, priors: [] });
  assert.equal(held.outcome, "hold");
  if (held.outcome !== "hold") return;
  const wrong = service.confirm(held.hold, 2, 1_000);
  assert.equal(wrong.outcome, "reject");
  const confirmed = service.confirm(held.hold, 3, 1_000);
  assert.equal(confirmed.outcome, "wait");
  if (confirmed.outcome !== "wait") return;
  const early = service.release(confirmed.hold, 1_000 + RECOVERY_DELAY_MS - 1);
  assert.equal(early.outcome, "wait");
  const ready = service.release(confirmed.hold, 1_000 + RECOVERY_DELAY_MS);
  assert.equal(ready.outcome, "execute");
  if (ready.outcome === "execute") assert.deepEqual(ready.agentIds, ["a", "b", "c"]);
});

test("a compromised root wallet cannot sweep ten agents in one session", () => {
  const agents = Array.from({ length: 10 }, (_, index) => `agent-${index}`);
  const unmitigated = agents.length;
  const priors: PriorRecovery[] = [];
  let executed = 0;
  let held = 0;
  agents.forEach((agentId, index) => {
    const decision = decideRecovery({
      rootWalletId: root,
      agentIds: [agentId],
      kind: "sweep",
      now: 1_000 + index,
      priors,
    });
    if (decision.outcome === "execute") {
      executed += 1;
      priors.push({ rootWalletId: root, agentId, at: 1_000 + index });
    } else if (decision.outcome === "hold") {
      held += 1;
    }
  });
  assert.equal(unmitigated, 10);
  assert.equal(executed, 3);
  assert.equal(held, 7);
});
