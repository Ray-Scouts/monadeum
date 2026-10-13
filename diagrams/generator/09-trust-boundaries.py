"""
Monadeum - 09 Trust boundaries: where one party's claim stops being believed.

Derived from:
  THREAT-MODEL.md section 3 (trust boundaries 1 to 10; the labels B1 to B10 below
                             are that numbering)
  THREAT-MODEL.md section 7 (invariants 2, 7, 11, 13, 17) and section 9 (the operator
                             is trusted for the MVP, a stated non-goal)
  SECURITY.md sections 1, 4, 5 and ARCHITECTURE.md sections 7, 9, 16.3, 16.5

B8 (no agent-to-agent path) and the owner boundary of B5 are enforced by the
reallocation contract, which is deployed on testnet with reallocation off.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _style import *

g = new_graph(
    "trust-boundaries",
    rankdir="TB",
    title="Trust boundaries: what each side may claim and who re-checks it",
    subtitle="B1 to B10 are the numbered trust boundaries of THREAT-MODEL.md section 3. The platform operator is trusted for the MVP.",
    source="THREAT-MODEL.md sections 3, 7, 9; SECURITY.md sections 1, 4, 5",
    ranksep="0.55",
    nodesep="0.5",
    newrank="true",
)

with g.subgraph(name="cluster_untrusted") as c:
    c.attr(**panel("Untrusted input", tint="#FBEFF4", line="#E3B5CC"))
    card(c, "browser", "Frontend in the browser", ["renders state and captures intent;", "never an authorization decision"],
         kind="threat", status=IMPL)
    card(c, "prov", "x402 provider responses", ["text and data are live input", "to anything that stores or logs them"],
         kind="threat", status=DESIGN)
    card(c, "gift", "Unsolicited transfer", ["a token or NFT sent to an", "agent's public address"],
         kind="threat", status=IMPL)

with g.subgraph(name="cluster_platform") as c:
    c.attr(**panel("Platform, trusted for the MVP", tint="#F2EFFE", line="#C9BFF6"))
    card(c, "api", "API", ["authenticates every request itself,", "re-derives ownership from its own records"],
         kind="service", status=IMPL)
    card(c, "strategy", "Strategy and LLM output", ["a proposal, never an authorization"],
         kind="service", status=OFF)
    card(c, "risk", "RiskModule", ["deterministic structural checks", "against a signed policy"],
         kind="control", status=OFF)
    card(c, "pg", "PostgreSQL read-model", ["B7  not a source of truth: security-", "critical facts are checked against an", "on-chain hash or event"],
         kind="neutral", status=IMPL)
    card(c, "paymaster", "Paymaster budget", ["B9  capped per agent; owner-signed", "revocation sponsored outside the cap"],
         kind="external", status=IMPL)

with g.subgraph(name="cluster_chain") as c:
    c.attr(**panel("Monad: enforces its rules whatever the platform does", tint="#EAF4FA", line="#B9D9EA"))
    card(c, "acct", "Agent account + spend policy", ["allowlist, recipient rule, caps;", "no default-allow path"],
         kind="chain", status=IMPL)
    card(c, "realloc", "Reallocation contract", ["same owner, owner's policy in force,", "cap, floor, ceiling"],
         kind="chain", status=OFF)
    card(c, "peer", "Another account, same owner", ["no direct path between agents", "outside the contract"],
         kind="chain", status=OFF)
    card(c, "owner", "Owner root wallet", ["owns every agent account;", "can revoke any session key"],
         kind="external", status=IMPL)

card(g, "arb", "Arbitrary address or contract", ["not on the allowlist"], kind="bad", status=OFF)
card(g, "other", "Another owner's accounts", ["closed to the mechanism entirely"], kind="bad", status=OFF)

link(g, "browser", "api", "B10  untrusted client;\nevery value re-validated", kind="danger")
link(g, "prov", "strategy", "B3  schema-validated,\nnever trusted", kind="danger", dashed=True)
link(g, "strategy", "risk", "B1  proposal only", kind="control")
link(g, "risk", "acct", "B2  approved plan;\nchain re-checks independently", kind="gate")
link(g, "gift", "acct", "changes no permission,\nlimit, or key scope", kind="danger")
link(g, "owner", "acct", "B6  revocable at any time,\nindependent of the agent", kind="control")
link(g, "acct", "arb", "B4  rejected", kind="danger")
link(g, "acct", "realloc", "B5  approve + reallocate", kind="gate", dashed=True)
link(g, "realloc", "peer", "B8  only path between agents", kind="gate", dashed=True)
link(g, "realloc", "other", "B5  reverts", kind="danger")

with g.subgraph() as sg:
    sg.attr(rank="same")
    sg.node("browser")
    sg.node("prov")
    sg.node("gift")
link(g, "api", "pg", style="invis")
link(g, "pg", "paymaster", style="invis")

render(g, "09-trust-boundaries")
