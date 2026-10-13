"""
Monadeum - 11 Root recovery: when a revoke runs now and when it is held.

Claim: a lone revoke runs at once, and a bulk action is held.

Derived from:
  SECURITY.md section 9, "Bulk recovery hold" (thresholds are proposed defaults),
                  section 1 (owner-controlled recovery)
  THREAT-MODEL.md scenario G, invariant 8, and section 8 (the hold can be waited
                  out by an attacker who controls the confirmation step)
  ARCHITECTURE.md sections 7 and 10 (revocation always sponsored, recovery log)
  libs/recovery/src/decide.ts (60 minute window, 15 minute delay, limit of 3)

Status on 2026-10-13: the hold is implemented in the application layer and not
exercised on testnet (ring). Chain-level enforcement is later work (issue 26) and
is described in the page caption. The numbers 60, 3, and 15 are proposed defaults,
not measurements.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from toolkit import Diagram, OBSERVED, BUILT, DESIGN, build

d = Diagram(
    "11-root-recovery",
    title="A lone revoke runs at once, a bulk action is held",
    subtitle="A stolen root credential must not stop or sweep every agent in one session.",
    desc=("Root recovery as a decision. An owner request goes to a hold test. One agent within the limit "
          "runs at once. Two or more agents, or more than three in an hour, are held until a second "
          "step and a delay, and then execute."),
    cols=4, gutter=100, rows=2, gaps={0: 0, 1: 100},
)
d.node("req", "Owner request", "Revoke, rotate, sweep", 0, 0, status=BUILT)
d.node("test", "Hold test", "Limit 3 per hour", 1, 0, status=BUILT, kind="accent")
d.node("run", "Runs at once", "Key destroyed first", 3, 0, status=BUILT, kind="good")
d.node("held", "Held", "Nothing runs yet", 1, 1, status=BUILT, kind="bad")
d.node("confirm", "Second step", "Restate count, wait", 2, 1, status=BUILT)
d.edge("req", "test", "count")
d.edge("test", "run", "one agent", kind="good")
d.edge("test", "held", "bulk", kind="bad")
d.edge("held", "confirm", "confirm")
d.edge("confirm", "run", "after delay", mode="hv")

if __name__ == "__main__":
    build(d, "11-root-recovery")
