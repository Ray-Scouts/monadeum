"""
Monadeum - 11 Root recovery: when a revoke or sweep runs now and when it is held.

Derived from:
  SECURITY.md section 9, "Bulk recovery hold" (thresholds are proposed defaults)
  SECURITY.md section 1   (owner-controlled recovery)
  THREAT-MODEL.md scenario G and invariant 8 (compromised root credential)
  THREAT-MODEL.md section 8 (the hold can be waited out by an attacker who
                            controls the confirmation step)
  ARCHITECTURE.md section 10 (API entry: Stop this agent, recovery log)
  ARCHITECTURE.md section 7  (revocation always sponsored)
  libs/recovery/src/decide.ts (60 minute window, 15 minute delay, limit of 3)

The hold is implemented in the application layer (libs/recovery, applied by
the API before anything executes). Chain-level enforcement of the same rule is
later work (issue 26) and is shown as designed. The numbers 60, 3, and 15 are
proposed defaults, not measurements.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _style import *

g = new_graph(
    "root-recovery",
    rankdir="TB",
    title="Root recovery: a lone revoke runs at once, a bulk action is held",
    subtitle="Scenario G: a stolen root credential could stop or sweep every agent of an owner in one session.",
    source="SECURITY.md sections 1, 9; THREAT-MODEL.md scenario G, section 8; libs/recovery",
    ranksep="0.45",
    nodesep="0.5",
    newrank="true",
)

card(g, "req", "Owner requests a revoke, rotate, or sweep",
     ["From the root wallet, naming one or more agent accounts"], kind="service", status=OFF)
card(g, "count", "Count distinct agents revoked or swept",
     ["By this root wallet in the last 60 minutes,", "including the agent now requested"], kind="control", status=OFF)
card(g, "q", "Hold test",
     ["Does the request name two or more agents,", "or would the distinct count exceed 3?"], kind="threat", status=OFF)
card(g, "exec", "Execute immediately",
     ["One agent, count still 3 or lower", "A single revoke never waits"], kind="control", status=OFF)
card(g, "hold", "Held: nothing executes",
     ["The user is notified with the list of agents affected", "Recorded per root wallet in the API's recovery log"],
     kind="bad", status=OFF)
card(g, "confirm", "Second confirmation",
     ["Restates how many agents are affected"], kind="service", status=OFF)
card(g, "delay", "15 minute delay, then execute",
     ["A legitimate owner can still retire every agent;", "there is no path that skips the hold"], kind="control", status=OFF)

card(g, "mech", "What a revocation does",
     ["Server-held key destroyed first, so no platform process can sign",
      "Owner-signed operation uninstalls the validators and invalidates the nonce",
      "Sponsored outside the per-agent gas budget; result read back from chain"],
     kind="chain", status=OFF)
card(g, "gap", "Paymaster down and no MON in the account",
     ["Key is already destroyed on the platform, but the chain still", "accepts it until the owner retries; reported as paymaster-unavailable"],
     kind="threat", status=OFF)
card(g, "chain", "On-chain enforcement of the same rule",
     ["Later work (issue 26); today the hold lives in the API"], kind="chain", status=DESIGN)
card(g, "resid", "Residual risk",
     ["An attacker who holds the root credential for longer than 15 minutes", "can complete the confirmation; the hold raises cost, it does not remove risk"],
     kind="threat", status=OFF)

link(g, "req", "count")
link(g, "count", "q")
link(g, "q", "exec", "no", kind="gate")
link(g, "q", "hold", "yes", kind="danger")
link(g, "hold", "confirm", "owner confirms", kind="control")
link(g, "confirm", "delay")
link(g, "exec", "mech", kind="gate")
link(g, "delay", "mech", kind="gate")
link(g, "mech", "gap", dashed=True, kind="danger", constraint="false")

for a, b in (("exec", "hold"), ("mech", "gap"), ("chain", "resid")):
    with g.subgraph() as sg:
        sg.attr(rank="same")
        sg.node(a)
        sg.node(b)
link(g, "mech", "chain", style="invis")

render(g, "11-root-recovery")
