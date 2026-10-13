"""
Monadeum - 04 Spend control layers: who checks a proposed action, and when.

Derived from:
  SECURITY.md section 1   (on-chain spend policy, x402 payment bounds)
  SECURITY.md section 4   (proposal is not authorization)
  SECURITY.md section 9   (layered caps, population circuit breaker as implemented)
  SECURITY.md section 13  (known limitations: daily cap breach pays gas,
                           layer 2 is deployment-wide)
  ARCHITECTURE.md section 16.1 (RiskModule rules)
  ARCHITECTURE.md section 16.3 (validation vs execution phase, recipient rule,
                           traded assets, x402 signature path, rolling window)
  THREAT-MODEL.md invariants 1, 7, 11, 17

The spend policy is deployed on Monad testnet, installed on the first agent
account, and not audited. No spending operation validated by it through a
bundler has been observed yet (SECURITY.md section 13).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _style import *

g = new_graph(
    "spend-control-layers",
    rankdir="TB",
    title="Spend control layers: what checks an action before capital moves",
    subtitle="The LLM or strategy output has no authority. The chain does not trust the off-chain engine to be correct.",
    source="SECURITY.md sections 1, 4, 9, 13; ARCHITECTURE.md sections 16.1, 16.3",
    ranksep="0.5",
    nodesep="0.5",
    newrank="true",
)

card(g, "prop", "Proposal",
     ["Strategy output: a trade intent or an information request", "A proposal is never an authorization"],
     kind="service", status=OFF)

card(g, "l2", "Layer 2: RiskModule, off chain",
     ["Signed, hash-chained policy; unverified means no action",
      "Allowlist, recipient of every transfer or approve, pair",
      "Plan hash equals the approved hash",
      "Per-action cap on the sum of all calls in the plan",
      "Session daily cap over the same rolling window as the chain",
      "Information caps per tick and per day"],
     kind="control", status=OFF)

card(g, "l1v", "Layer 1a: spend policy check, validation phase",
     ["Target and selector on the allowlist, never the policy",
      "or the account itself",
      "Recipient decoded only on transfer and approve of the",
      "settlement asset or a traded asset; must be an allowed contract",
      "Zero native value; per-tx cap on the sum of a batch"],
     kind="chain", status=OFF)

card(g, "l1e", "Layer 1b: spend policy record, execution phase",
     ["Rolling daily cap: 25 hourly buckets, never under-counts",
      "Needs the clock, which ERC-7562 forbids in validation"],
     kind="chain", status=OFF)

card(g, "done", "Transfer executes",
     ["Settlement asset moves only to an allowlisted contract", "within the per-transaction and daily caps"],
     kind="neutral", status=OFF)

card(g, "rej2", "Refused, nothing sent", ["Every violation is returned", "and logged with policy hash"],
     kind="bad", status=OFF)
card(g, "rej1", "Operation invalid", ["Rejected before inclusion,", "no gas paid"], kind="bad", status=OFF)
card(g, "rej1e", "Execution reverts", ["Nothing recorded,", "gas is still paid"], kind="bad", status=OFF)

with g.subgraph(name="cluster_side") as c:
    c.attr(**panel("Controls outside the user-operation path"))
    card(c, "x402", "x402 payments",
         ["Separate x402 key, ERC-1271 path only", "Payee list, 0.05 USDC each, 300 s, 4 per hour",
          "At most 26 x 4 x 0.05 = 5.20 USDC per 24 h",
          "Counted by the token nonce, not the daily cap"],
         kind="chain", status=OFF)
    card(c, "erc1271", "Trading key cannot sign",
         ["ERC-1271 check always fails; the", "skip-signature flag is never set"],
         kind="control", status=OFF)
    card(c, "l3", "Population circuit breaker",
         ["Checked every evaluation: capital at risk, and", "reallocation volume. A trip halts every tick across", "restarts until a human clears it; built, tested offline"],
         kind="control", status=OFF)
    card(c, "stop", "Owner stop",
         ["Per-agent key revocation is immediate;", "bulk actions are held (diagram 11)"],
         kind="control", status=OFF)
    c.edge("x402", "l3", style="invis")
    c.edge("erc1271", "stop", style="invis")

link(g, "prop", "l2", kind="control")
link(g, "l2", "l1v", "approved plan only", kind="gate")
link(g, "l1v", "l1e", "valid operation", kind="gate")
link(g, "l1e", "done", "within caps", kind="gate")
link(g, "l2", "rej2", "any violation", kind="danger")
link(g, "l1v", "rej1", "any violation", kind="danger")
link(g, "l1e", "rej1e", "daily cap", kind="danger")
link(g, "done", "x402", style="invis")

for a, b in (("l2", "rej2"), ("l1v", "rej1"), ("l1e", "rej1e"), ("x402", "erc1271"), ("l3", "stop")):
    with g.subgraph() as s:
        s.attr(rank="same")
        s.node(a)
        s.node(b)

render(g, "04-spend-control-layers")
