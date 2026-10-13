"""
Monadeum - 12 Evidence chain: from a hypothesis to a switched-off feature.

Derived from:
  EVOLUTION.md section 3.5   (simulation evidence, issues 85, 89, 92)
  EVOLUTION.md section 7     (item 4, the gating unknown, and the issue 102 outcome)
  EVOLUTION.md section 8.5   (how the mechanism was adopted and why it is gated)
  ARCHITECTURE.md section 5  (reallocation switch, off by default, production
                              acknowledgement)
  simulation/results/genome-edge-preregistration.md and genome-edge.md
  ECONOMICS.md section 8     (the decision rule the studies were held to)

The numbers below are quoted from simulation/results/genome-edge.md as
summarized in EVOLUTION.md section 7. The study covers one strategy plugin on
Kuru MON-USDC; it says nothing about strategies with a different signal or
with information purchases that pay, which it could not replay.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _style import *

g = new_graph(
    "evidence-chain",
    rankdir="TB",
    title="Evidence chain: how the issue 102 study turned reallocation off",
    subtitle="A decision is written down with its evidence, and what it implies is switched off in code, not only in prose.",
    source="EVOLUTION.md sections 3.5, 7, 8.5; ARCHITECTURE.md section 5; simulation/results/genome-edge*.md",
    legend_extra=("In this diagram a thick border also marks a stage that was run and reported",),
    ranksep="0.42",
    nodesep="0.5",
    newrank="true",
)

card(g, "pre", "Before the study: simulation evidence",
     ["Issues 85, 89, 92 (simulation only, assumed genome edge 0.006 or 0.009):",
      "owner-scoped reallocation beat a static population in 11 of 12 cells at 0.009",
      "Adopted as a design, not as a claim about production returns"],
     kind="neutral", status=IMPL)
card(g, "hyp", "1  Hypothesis",
     ["The production strategy's genomes carry a net, persistent edge", "of at least the modeled size (the gating unknown)",
      "Reallocation converts an edge into return; it does not create one"],
     kind="service", status=IMPL)
card(g, "reg", "2  Pre-registration",
     ["Design, thresholds, and decision rule fixed in genome-edge-preregistration.md,",
      "committed before any study data was fetched",
      "Deviations are stated before the results"],
     kind="control", status=IMPL)
card(g, "sim", "3  Backtest on real data",
     ["1,000 genomes of the long-or-flat plugin on hourly closes built from Kuru MON-USDC trades",
      "In-sample 2025-12-23 to 2026-05-31, held out 2026-06-01 to 2026-09-30",
      "Net of measured costs: 0 bps taker fee, 7.4 bps half-spread, gas per swap"],
     kind="service", status=IMPL)
card(g, "res", "4  Result: negative on all three tests",
     ["Edge: top fifth beat bottom fifth by 0.028 sd per tick (bounds 0.015 to 0.039), modeled 0.278",
      "Rank persistence: 0.066 (bounds 0.027 to 0.103), modeled 0.416; at zero cost -0.017",
      "Calibrated re-run at magnitude 0: inconclusive, 2 of 12 cells significant, both lower"],
     kind="bad", status=IMPL)
card(g, "dec", "5  Decision recorded in a core document",
     ["EVOLUTION.md section 7 item 4: no-go for the current strategy plugin", "The product rests on well-calibrated static agents",
      "ARCHITECTURE.md section 5 records the switch and its production gate"],
     kind="control", status=IMPL)
card(g, "off", "6  What is switched off as a result",
     ["MONADEUM_REALLOCATION_ENABLED: unset means false; any other value refuses to start",
      "Evaluation still runs fitness and retirement; no policy read, nothing planned or sent",
      "API refuses POST /policies/reallocation with 409 reallocation-disabled; the web shows it off"],
     kind="threat", status=OFF)
card(g, "gate", "Production gate",
     ["Needs MONADEUM_REALLOCATION_PRODUCTION_ACK, which may be set only after a new", "pre-registered study, on a strategy with a real signal, reports a persistent edge"],
     kind="control", status=OFF)
card(g, "limit", "What the study does not show",
     ["Nothing about strategies with a different signal,", "or with information purchases that pay"],
     kind="neutral", status=DESIGN)

for a, b in (("pre", "hyp"), ("hyp", "reg"), ("reg", "sim"), ("sim", "res"), ("res", "dec"), ("dec", "off")):
    link(g, a, b, kind="control")
link(g, "off", "gate")
link(g, "res", "limit", dashed=True, constraint="false")

with g.subgraph() as sg:
    sg.attr(rank="same")
    sg.node("res")
    sg.node("limit")
for n in ("pre", "hyp", "reg", "sim", "res", "dec", "off", "gate"):
    g.node(n, group="m")

render(g, "12-evidence-chain")
