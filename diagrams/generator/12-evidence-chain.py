"""
Monadeum - 12 Evidence chain: from a pre-registered test to a switched-off feature.

Claim: a negative study switched reallocation off, in code and not only in prose.

Derived from:
  EVOLUTION.md section 3.5 (simulation evidence), section 7 (item 4, the gating
                  unknown, the issue 102 outcome), section 8.5 (why the mechanism
                  is gated)
  ARCHITECTURE.md section 5 (reallocation switch, production acknowledgement)
  simulation/results/genome-edge-preregistration.md and genome-edge.md
  ECONOMICS.md section 8 (the decision rule the studies were held to)

Numbers are quoted from simulation/results/genome-edge.md as summarized in
EVOLUTION.md section 7: the top fifth beat the bottom fifth by 0.028 sd per tick,
against 0.278 modeled. The study covers one strategy plugin on Kuru MON-USDC and
says nothing about other strategies. In this figure the filled dot means a stage
that was run and reported, not a testnet observation.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from toolkit import Diagram, OBSERVED, BUILT, DESIGN, build

d = Diagram(
    "12-evidence-chain",
    title="A negative study switched reallocation off, in code",
    subtitle="The decision is written down with its evidence, and the feature is gated.",
    desc=("The evidence chain as a vertical path: a pre-registered test, a backtest on real data, a negative "
          "result, a recorded no-go decision, and the reallocation switch set off with a production gate. "
          "The study scope is limited to one strategy plugin."),
    cols=4, gutter=100, rows=5, gaps={0: 0, 1: 60, 2: 60, 3: 60, 4: 60},
    legend_filled="Run and reported", legend_ring="Built, off by default",
    legend_dashed="Not shown by the study",
)
d.node("pre", "Pre-registered test", "Rules fixed before any data", 0, 0, span=2, status=OBSERVED)
d.node("sim", "Backtest", "1,000 genomes, held-out data", 0, 1, span=2, status=OBSERVED)
d.node("res", "Edge not found", "0.028 observed, 0.278 modeled", 0, 2, span=2, status=OBSERVED, kind="bad")
d.node("dec", "No-go recorded", "In EVOLUTION.md section 7", 0, 3, span=2, status=OBSERVED)
d.node("off", "Reallocation off", "Unset means false", 0, 4, span=2, status=BUILT, kind="accent")
d.node("limit", "Study scope", "One strategy plugin", 3, 2, status=DESIGN)
d.node("gate", "Production gate", "Needs a new study", 3, 4, status=BUILT)
d.edge("pre", "sim", "then run")
d.edge("sim", "res", "reported")
d.edge("res", "dec", "recorded")
d.edge("dec", "off", "switched off", kind="accent")
d.edge("res", "limit", "limits", dashed=True)
d.edge("gate", "off", "unlocks")

if __name__ == "__main__":
    build(d, "12-evidence-chain")
