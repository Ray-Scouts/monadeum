"""
Monadeum - 08 Worker tick: one agent, one interval, and where it stops.

Claim: a tick either submits an approved plan or stops without acting.

Derived from:
  ARCHITECTURE.md section 11 (worker: BullMQ jobs, idempotency, per-agent lock,
                  tick runner, signed policy gate, genome commitment check,
                  population breaker)
  ARCHITECTURE.md section 10 (TradingModule), section 14 (failure handling)
  SECURITY.md sections 8 and 9 (fail closed, population circuit breaker)
  THREAT-MODEL.md invariants 6, 7, 10

Status on 2026-10-13: the tick runner is off by default (WORKER_TICK_RUNNER=enabled).
No tick has run against the live testnet deployment, because the WMON/USDC market
was not on chain on 2026-10-12. Every step is implemented and tested offline, so
every node is a ring. The tick interval is one hour by design; the testnet value
decided on 2026-10-13 is five minutes, so the figure names no interval.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from toolkit import Diagram, OBSERVED, BUILT, DESIGN, build

d = Diagram(
    "08-worker-tick",
    title="A tick either submits an approved plan or stops without acting",
    subtitle="Any failure ends the tick with no action, and that outcome is final for the tick key.",
    desc=("One worker tick as a vertical path: claim the tick, check the gates, observe, propose, "
          "check risk, submit, and measure. Four steps can fail, and each failure leads to a single "
          "no-action outcome that is final for that tick."),
    cols=4, gutter=100, rows=7, gaps={0: 0, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60},
)
d.node("claim", "Claim tick", "Per-agent lock, one key", 0, 0, span=2, status=BUILT)
d.node("gates", "Check gates", "Breaker, policy, commitment", 0, 1, span=2, status=BUILT)
d.node("observe", "Observe", "Market mid, balance, signal", 0, 2, span=2, status=BUILT)
d.node("propose", "Propose plan", "Long, flat, or none", 0, 3, span=2, status=BUILT)
d.node("risk", "Risk check", "Plan hash approved", 0, 4, span=2, status=BUILT, kind="accent")
d.node("submit", "Submit", "Session key, approved hash", 0, 5, span=2, status=BUILT, kind="good")
d.node("measure", "Measure", "One fitness cost entry", 0, 6, span=2, status=BUILT)
d.node("stop", "No action", "Final for this tick key", 3, 3, status=BUILT, kind="bad")
d.edge("claim", "gates", "locked")
d.edge("gates", "observe", "all pass")
d.edge("observe", "propose", "signal")
d.edge("propose", "risk", "plan")
d.edge("risk", "submit", "approved plan only", kind="good")
d.edge("submit", "measure", "outcome")
XM = d.gutter_x(1, 0.5) + 150
d.edge("gates", "stop", "gate fails", kind="bad", mode="hvh", to=-32, mid=XM, lseg=0)
d.edge("observe", "stop", "read fails", kind="bad", mode="hvh", to=-16, mid=XM, lseg=0)
d.edge("propose", "stop", "no plan", kind="bad")
d.edge("risk", "stop", "rejected", kind="bad", mode="hvh", to=32, mid=XM, lseg=0)

if __name__ == "__main__":
    build(d, "08-worker-tick")
