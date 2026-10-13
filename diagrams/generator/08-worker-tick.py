"""
Monadeum - 08 Worker tick: what happens in one hourly tick of one agent.

Derived from:
  ARCHITECTURE.md section 11  (worker architecture: BullMQ jobs, idempotency,
                               per-agent lock, tick runner, signed policy gate,
                               market signal, known limits)
  ARCHITECTURE.md section 10  (TradingModule: plan shape, no double sell,
                               submission, fill tracking)
  ARCHITECTURE.md section 14  (failure handling, fail closed)
  SECURITY.md section 8       (fail-closed behavior)
  THREAT-MODEL.md invariants 6, 7, 10

The tick runner is off by default (WORKER_TICK_RUNNER=enabled). No tick has
run against the live testnet deployment: the testnet WMON/USDC market was not
on chain on 2026-10-12, so every step below is implemented and tested offline
but not observed live.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _style import *

g = new_graph(
    "worker-tick",
    rankdir="TB",
    title="Worker tick: one agent, one hour, and every point where it stops without acting",
    subtitle="Any failure ends the tick with no action, and that outcome is final for that tick key.",
    source="ARCHITECTURE.md sections 10, 11, 14; SECURITY.md section 8",
    ranksep="0.4",
    nodesep="0.6",
    newrank="true",
)

steps = [
    ("t1", "Trigger job fires",
     ["Tick number = whole tick intervals since the Unix epoch", "Same number in every process for the same interval"], "service"),
    ("t2", "Enqueue tick job",
     ["Job id derived from the tick key (agent id, tick number)", "A duplicate trigger adds nothing"], "service"),
    ("t3", "Take the per-agent Redis lock",
     ["Concurrency of 1 per agent; lock held: retry later,", "not counted as a failed attempt"], "service"),
    ("t4", "Sample the market mid",
     ["(best bid + best ask) / 2, first valid read of the tick,", "stored once in market_mid_samples, funded agent or not"], "service"),
    ("t5", "Policy gate",
     ["Verify every stored policy version against WORKER_POLICY_SIGNER;", "one in effect must cover the configured market",
      "Otherwise skipped before anything is claimed or sent"], "control"),
    ("t6", "Claim the tick record",
     ["Insert-if-absent per (agent id, tick); a restart resumes", "the approved plan and never decides again"], "service"),
    ("t7", "Observe and read the signal",
     ["Balance and rolling-window spend read from chain", "Signal = trailing mean of mid returns over timeHorizon, minus entryThreshold"], "service"),
    ("t8", "Propose and build the plan",
     ["Long: approve exact notional, then swap with minAmountOut", "Flat: close the whole open position; no information offered"], "service"),
    ("t9", "RiskModule evaluates the plan",
     ["Approval and plan hash written to the tick record before submission"], "control"),
    ("t10", "Submit through the session key",
     ["Only a plan whose hash equals the approved hash is sent", "Restart: reconcile by tick key before any resend"], "service"),
    ("t11", "Measure once per tick key",
     ["Gas, fees, slippage, x402 spend, realized P&L of a close", "become one fitness cost entry"], "service"),
]
for nid, title, lines, kind in steps:
    card(g, nid, title, lines, kind=kind, status=OFF)
    g.node(nid, group="m")

card(g, "stop", "No action, final for this tick key",
     ["Unreadable chain or market, policy missing or unverified,",
      "plan not buildable, RiskModule rejection, signer refusal,",
      "unknown outcome: stays open and is reconciled by the same key",
      "The next scheduled tick runs normally"],
     kind="bad", status=OFF)
card(g, "ev", "Evaluate job, every 20th tick",
     ["Enqueued with the trigger, delayed by half a tick interval", "so that tick's agent jobs run first (diagram 5)"],
     kind="control", status=OFF)
card(g, "gap", "Known limits, not verified live",
     ["No tick has run on the live deployment", "Signal needs timeHorizon + 1 whole samples:",
      "25 ticks with the conservative preset", "A flat seeded book gives signal 0, so no buy"],
     kind="threat", status=DESIGN)

ids = [s[0] for s in steps]
for a, b in zip(ids, ids[1:]):
    link(g, a, b, kind="flow")
link(g, "t5", "stop", "no valid policy", kind="danger", constraint="false")
link(g, "t7", "stop", "read or signal fails", kind="danger", constraint="false")
link(g, "t9", "stop", "rejected", kind="danger", constraint="false")
link(g, "t10", "stop", "signer refuses", kind="danger", constraint="false")
link(g, "t2", "ev", "on the evaluation cadence", kind="control", constraint="false")

for a, b in (("t3", "ev"), ("t5", "stop"), ("t9", "gap")):
    with g.subgraph() as sg:
        sg.attr(rank="same")
        sg.node(a)
        sg.node(b)

render(g, "08-worker-tick")
