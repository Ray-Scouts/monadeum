"""
Monadeum - 02 Agent lifecycle: created, active, retired, and the separate stop.

Claim: retirement and an owner stop are different things; retirement moves no capital.

Derived from:
  ARCHITECTURE.md section 4 (agent lifecycle) and section 5 (evaluation, retirement)
  ARCHITECTURE.md section 6.1 and 10 (principal from finalized indexed transfers,
                              creation, stop this agent)
  ARCHITECTURE.md section 11 (tick runner, off by default)
  EVOLUTION.md section 6 (retirement rules; the 0.06 floor and K = 3 windows are
                              proposed defaults, stated in the page caption)
  THREAT-MODEL.md invariants 8, 9, 15

Status on 2026-10-13: creation and account deployment were observed on testnet
(2026-10-11). Activation needs the tick runner (off by default), so Active,
Retired, and Stopped are built and not observed. The owner retire endpoint is
not built, so only the evaluation path to Retired is drawn.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from toolkit import Diagram, OBSERVED, BUILT, DESIGN, build

d = Diagram(
    "02-agent-lifecycle",
    title="Retiring an agent never moves its capital",
    subtitle="Retirement and the owner stop are separate paths with different effects.",
    desc=("Lifecycle in three states: Created, Active, Retired, with a separate Stopped state. "
          "Reading: a funded agent becomes active, a failed evaluation retires it and leaves its balance "
          "in place, and an owner stop revokes the session key without retiring."),
    cols=3, gutter=140, rows=2, gaps={0: 0, 1: 90},
)
d.node("created", "Created", "Account deployed, principal 0", 0, 0, status=OBSERVED)
d.node("active", "Active", "Ticks once funded", 1, 0, status=BUILT, kind="accent")
d.node("retired", "Retired", "Balance stays, owner recovers", 2, 0, status=BUILT)
d.node("stopped", "Stopped", "Key revoked, not retired", 1, 1, status=BUILT)
d.edge("created", "active", "funded")
d.edge("active", "retired", "below floor", kind="bad")
d.edge("active", "stopped", "owner stop", kind="bad")

if __name__ == "__main__":
    build(d, "02-agent-lifecycle")
