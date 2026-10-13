"""
Monadeum - 05 Reallocation and retirement: one evaluation, step by step.

Derived from:
  ARCHITECTURE.md section 5    (reallocation and retirement lifecycle, one debit
                                per source per evaluation, switch off by default)
  ARCHITECTURE.md section 16.5 (contract checks, minEvaluationInterval 36000 s)
  EVOLUTION.md section 3.1     (mechanism, small-pool rule, amounts)
  EVOLUTION.md section 6       (retirement)
  EVOLUTION.md section 7       (item 4: issue 102 no-go, why the switch is off)
  THREAT-MODEL.md invariants 3, 4, 12, 13, 15

Constants (cap 0.2, ceiling 4, floor 0.06, every 20 ticks, K = 3) are proposed
defaults, fixed in the contract at deployment. Reallocation is implemented but
off by default; the worker's executor sends nothing, so no worker-submitted
reallocation has reached the deployed contract.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _style import *

g = new_graph(
    "reallocation-retirement",
    rankdir="TB",
    title="Reallocation and retirement: one evaluation, and the switch that gates the moves",
    subtitle="Retirement always runs and moves nothing. Reallocation runs only when MONADEUM_REALLOCATION_ENABLED is true; it is unset by default.",
    source="ARCHITECTURE.md sections 5, 16.5; EVOLUTION.md sections 3.1, 6, 7",
    ranksep="0.45",
    nodesep="0.45",
    newrank="true",
)

card(g, "start", "Evaluation, every 20 ticks",
     ["Proposed default, 20 hours at a one-hour tick", "Never on every tick, to avoid noisy single-tick decisions"],
     kind="control", status=OFF)
card(g, "fit", "Fitness for every Active agent",
     ["Adjusted fitness, niches, starvation count, population-wide"], kind="control", status=OFF)
card(g, "ret", "Retirement, always on",
     ["Capital below the 0.06 floor, or bottom decile of its niche for K = 3 windows",
      "Capital stays in the agent's own account; nothing moves"], kind="neutral", status=OFF)
card(g, "rec", "Evaluation records written last",
     ["One row per evaluated agent, insert-if-absent per (agent, sequence)"], kind="neutral", status=OFF)

card(g, "switch", "Switch on?",
     ["Off after the issue 102 no-go: no policy is read,", "nothing is planned, nothing reaches the contract"],
     kind="threat", status=OFF, shape="box")

card(g, "plan", "Plan per owner with a policy in force",
     ["Rank the owner's covered Active agents by adjusted fitness",
      "Small pool: none under 2; bottom 1 and top 1 for 2 to 19;",
      "bottom and top n/10 from 20",
      "Debit per source: min(0.2 x capital, capital - 0.06)",
      "Credit per sink: up to 4 x principal minus capital"],
     kind="service", status=OFF)
card(g, "risk", "RiskModule: ReallocationProposal",
     ["One debit per source, converted to base units rounding down",
      "Violations kept apart: party, policy, bound"], kind="control", status=OFF)
card(g, "op", "Source account: one operation",
     ["approve(contract, total) on the settlement asset, counted by the spend policy",
      "then reallocate(evaluation, policyHash, credits)"], kind="chain", status=OFF)
card(g, "chk", "AgentReallocation checks on chain",
     ["Evaluation number is current; source not yet debited in it",
      "Same owner, all Active, no sink is the source",
      "Owner policy in force, hash matches, names every agent",
      "Total within cap and floor; each sink within ceiling"],
     kind="chain", status=OFF)
card(g, "move", "transferFrom(source, sink, amount)",
     ["Once per credit, the contract never holds a balance", "Event Reallocated(owner, source, sink, amount, evaluation)", "Indexed per followed side when the indexer is configured"],
     kind="chain", status=OFF)
card(g, "revert", "Whole call reverts",
     ["Nothing moves; not retried in this evaluation", "Next evaluation recomputes from fresh state"],
     kind="bad", status=OFF)
card(g, "skip", "Moves skipped",
     ["Retirement already ran;", "evaluation records are still written"], kind="neutral", status=OFF)
card(g, "gate", "Operator and spacing",
     ["Operator and admin are 2-of-3 multisigs;", "evaluations at least 36000 s apart"],
     kind="control", status=OFF)

link(g, "start", "fit")
link(g, "fit", "ret", kind="control")
link(g, "ret", "switch")
link(g, "switch", "skip", "off (default)", kind="danger")
link(g, "switch", "plan", "on", kind="gate")
link(g, "plan", "risk")
link(g, "risk", "op", "approved", kind="gate")
link(g, "op", "chk")
link(g, "chk", "move", "all hold", kind="gate")
link(g, "chk", "revert", "any fails", kind="danger")
link(g, "move", "rec")
link(g, "gate", "chk", dashed=True, kind="control", constraint="false")

for a, b in (("switch", "skip"), ("chk", "revert"), ("op", "gate")):
    with g.subgraph() as s:
        s.attr(rank="same")
        s.node(a)
        s.node(b)

render(g, "05-reallocation-retirement")
