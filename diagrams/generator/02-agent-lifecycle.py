"""
Monadeum - 02 Agent lifecycle: from creation to retirement.

Derived from:
  ARCHITECTURE.md section 4  (agent lifecycle)
  ARCHITECTURE.md section 5  (evaluation steps, reallocation switch)
  ARCHITECTURE.md section 6.1 and 10 (principal from finalized indexed transfers,
                              creation, stop this agent)
  ARCHITECTURE.md section 11 (tick runner, off by default)
  EVOLUTION.md section 6     (retirement rules, proposed defaults)
  THREAT-MODEL.md invariants 8, 9, 15

Numeric values (floor 0.06, K = 3, 20 ticks) are proposed defaults in the
documents, not measured values, and are labeled that way here.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _style import *

g = new_graph(
    "agent-lifecycle",
    rankdir="TB",
    title="Agent lifecycle: created, active, retired, and the separate stop",
    subtitle="Retirement never deletes an agent and never moves capital. A stop revokes the session key and is not retirement.",
    source="ARCHITECTURE.md sections 4, 5, 6.1, 10, 11; EVOLUTION.md section 6",
    ranksep="0.7",
    nodesep="0.5",
)

card(g, "created", "Created",
     ["Owner picks a preset; the server builds and hashes the genome",
      "Kernel account deployed with sponsored gas, then indexed",
      "Principal is 0, so the agent is not ticked yet"],
     kind="service", status=IMPL)

card(g, "active", "Active",
     ["Ticks once per hour (decided tick length)",
      "Needs a signed risk policy and the tick runner,",
      "which is off by default"],
     kind="service", status=OFF)

card(g, "tick", "Each tick",
     ["1  observe capital, window spend, market mid",
      "2  information purchase: none offered, payer off",
      "3  strategy proposes one action or none",
      "4  RiskModule evaluates the plan",
      "5  execute the approved plan, then measure"],
     kind="control", status=OFF)

card(g, "eval", "Each evaluation, every 20 ticks",
     ["Proposed default: 20 hours at a one-hour tick",
      "Fitness, niches, starvation count, retirement check",
      "Reallocation steps run only if the switch is on (off)"],
     kind="control", status=OFF)

card(g, "retired", "Retired",
     ["Stops ticking, never a reallocation source or sink",
      "Balance stays in its own account, owner can recover it",
      "Identity persists as inactive; there is no deleted state"],
     kind="neutral", status=OFF)

card(g, "stopped", "Stopped",
     ["Owner emergency stop: session key destroyed,",
      "then revoked on chain by an owner signature",
      "A new key can be issued; the agent is not retired"],
     kind="threat", status=OFF)

card(g, "registry", "Identity registry",
     ["ERC-8004 compatible status = inactive", "not built"],
     kind="chain", status=DESIGN)

link(g, "created", "active", "owner transfer finalized and indexed,\nprincipal above 0", kind="control")
link(g, "active", "tick", "every tick")
link(g, "active", "eval", "evaluation tick", kind="control")
link(g, "eval", "retired",
     "capital below floor 0.06 (proposed default)\nor bottom decile of niche for K = 3 windows\n(K is a proposed default)",
     kind="danger")
link(g, "active", "retired", "owner retires the agent\n(endpoint not built)", kind="danger", dashed=True, constraint="false")
link(g, "active", "stopped", "POST /agents/:id/stop", kind="danger")
link(g, "retired", "registry", "status change", kind="chain", dashed=True)

with g.subgraph() as s:
    s.attr(rank="same")
    s.node("tick")
    s.node("eval")
    s.node("stopped")

render(g, "02-agent-lifecycle")
