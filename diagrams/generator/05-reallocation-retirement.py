"""
Monadeum - 05 Reallocation and retirement: one evaluation and the switch.

Claim: reallocation is off by default, and retirement never moves capital.

Derived from:
  ARCHITECTURE.md section 5 (reallocation and retirement lifecycle, one debit per
                  source per evaluation, switch off by default)
  ARCHITECTURE.md section 16.5 (contract checks, minEvaluationInterval 36000 s)
  EVOLUTION.md section 3.1 (mechanism), section 6 (retirement), section 7 item 4
                  (the issue 102 no-go and why the switch is off)
  THREAT-MODEL.md invariants 3, 4, 12, 13, 15

Status on 2026-10-13: AgentReallocation is deployed on testnet (deployment record,
2026-10-11) with the switch off. No worker-submitted reallocation has reached it,
so every node is a ring. Constants (cap 0.2, floor 0.06, every 20 ticks) are
proposed defaults and are stated in the page caption, not drawn.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from toolkit import Diagram, OBSERVED, BUILT, DESIGN, build

d = Diagram(
    "05-reallocation-retirement",
    title="Reallocation is off by default, and retirement moves nothing",
    subtitle="Fitness and retirement always run. Moves run only when the switch is on.",
    desc=("One evaluation as a vertical path. Evaluation always runs retirement, which leaves capital in place. "
          "A switch, off by default, gates planning, the RiskModule, the on-chain contract checks, and the move."),
    cols=4, gutter=100, rows=6, gaps={0: 52, 1: 60, 2: 60, 3: 60, 4: 112, 5: 60},
)
d.zone("Off chain", rows=(0, 3))
d.zone("On chain", rows=(4, 5))
d.node("eval", "Evaluation", "Fitness for every active agent", 0, 0, span=2, status=BUILT)
d.node("retire", "Retirement", "Capital stays in account", 3, 0, status=BUILT)
d.node("switch", "Switch", "Off unless explicitly enabled", 0, 1, span=2, status=BUILT, kind="accent")
d.node("skip", "Moves skipped", "Records still written", 3, 1, status=BUILT)
d.node("plan", "Plan", "Per owner, policy in force", 0, 2, span=2, status=BUILT)
d.node("risk", "RiskModule", "One debit per source", 0, 3, span=2, status=BUILT)
d.node("checks", "Contract checks", "Same owner, caps, policy hash", 0, 4, span=2, status=BUILT)
d.node("revert", "Call reverts", "Nothing moves", 3, 4, status=BUILT, kind="bad")
d.node("move", "Funds move", "One transfer per credit", 0, 5, span=2, status=BUILT, kind="good")
d.edge("eval", "retire", "always runs")
d.edge("eval", "switch", "fitness")
d.edge("switch", "skip", "switch off", kind="accent")
d.edge("switch", "plan", "switch on")
d.edge("plan", "risk", "proposal")
d.edge("risk", "checks", "approved", kind="good")
d.edge("checks", "move", "all hold", kind="good")
d.edge("checks", "revert", "any fails", kind="bad")

if __name__ == "__main__":
    build(d, "05-reallocation-retirement")
