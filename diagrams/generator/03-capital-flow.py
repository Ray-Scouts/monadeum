"""
Monadeum - 03 Capital flow: where an owner's capital can and cannot go.

Derived from:
  ARCHITECTURE.md section 3    (capital flow, what the account never spends on)
  ARCHITECTURE.md section 6.1  (funding flow, principal from indexed transfers)
  ARCHITECTURE.md section 7    (gasless onboarding, relayed allocation, paymaster)
  ARCHITECTURE.md section 16.3 (recipient rule, x402 bound 26 * paymentsPerEpoch * maxValue)
  ARCHITECTURE.md section 16.5 (reallocation moves only between accounts of one owner)
  EVOLUTION.md sections 3.2, 3.3, 6 (no treasury, conservation, retirement moves nothing)
  THREAT-MODEL.md invariants 3, 11, 13, 15

Capital is never created by the platform: reallocation and retirement move
or leave existing capital only.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _style import *

g = new_graph(
    "capital-flow",
    rankdir="TB",
    title="Capital flow: how funds reach an agent, what it may spend on, and what it may never do",
    subtitle="Only the owner's own funds enter. The agent account is the custody boundary. Nothing here creates capital.",
    source="ARCHITECTURE.md sections 3, 6.1, 7, 16.3, 16.5; EVOLUTION.md sections 3.2, 3.3, 6",
    ranksep="0.4",
    nodesep="0.5",
    compound="true",
)

card(g, "ramp", "Card on-ramp (Ramp Network)", ["USDC on Monad mainnet, destination set by API", "flow not built, vendor terms unverified"],
     kind="external", status=DESIGN)
card(g, "wallet", "Owner's embedded wallet", ["holds USDC, signs the allocation", "owner of every agent account"],
     kind="external", status=IMPL)
card(g, "relay", "Relayed allocation", ["EIP-3009 authorization signed by the owner", "relayer pays gas, per-user daily count",
                                       "no relayed transfer executed on testnet yet"],
     kind="service", status=OFF)
card(g, "acct", "Agent smart account", ["sole custody boundary of the agent",
                                       "principal = owner deposits minus owner withdrawals"],
     kind="chain", status=IMPL)
card(g, "indexer", "Indexer", ["counts only finalized Transfers of the", "configured USDC contract"],
     kind="service", status=IMPL)

card(g, "treasury", "Treasury funding", ["deferred, not part of", "the adopted mechanism"],
     kind="neutral", status=DESIGN)

with g.subgraph(name="cluster_spend") as c:
    c.attr(**panel("The account may spend on"))
    card(c, "trade", "Trade on Kuru", ["approve + swap through the router", "per-tx cap and rolling daily cap"],
         kind="external", status=OFF)
    card(c, "x402", "x402 information", ["EIP-3009 payment to a listed payee", "at most 26 x paymentsPerEpoch x maxValue", "per 24 hours, on top of the daily cap"],
         kind="external", status=OFF)
    card(c, "gas", "Gas", ["sponsored up to a per-agent budget,", "then paid in MON by the account"],
         kind="external", status=IMPL)
    card(c, "realloc", "Reallocate within one owner", ["one debit per source per evaluation, under the", "owner's signed policy; switch is off by default"],
         kind="chain", status=OFF)
    c.edge("trade", "x402", style="invis")
    c.edge("x402", "gas", style="invis")
    c.edge("gas", "realloc", style="invis")

with g.subgraph(name="cluster_block") as c:
    c.attr(**panel("The account may never"))
    card(c, "never", "Pay an address of its choosing",
         ["transfer or approve of USDC must name the", "Kuru router or the reallocation contract",
          "no native MON value in any call"],
         kind="bad", status=OFF)
    card(c, "other", "Move capital across owners", ["or create a new account to receive it"],
         kind="bad", status=OFF)
    card(c, "retired", "Sweep capital on retirement", ["a retired balance stays in its own account"],
         kind="bad", status=OFF)
    c.edge("never", "other", style="invis")
    c.edge("other", "retired", style="invis")

link(g, "ramp", "wallet", "card payment", dashed=True)
link(g, "wallet", "relay", "owner signs\nthe allocation", kind="control")
link(g, "relay", "acct", "USDC transfer", kind="chain")
link(g, "indexer", "acct", "Transfer log", kind="chain", dir="back", constraint="false")
link(g, "treasury", "acct", dashed=True, constraint="false")
link(g, "acct", "trade", "counted at approve", kind="gate", lhead="cluster_spend")
link(g, "acct", "never", "rejected on chain", kind="danger", lhead="cluster_block")

with g.subgraph() as s:
    s.attr(rank="same")
    s.node("relay")
    s.node("treasury")
with g.subgraph() as s:
    s.attr(rank="same")
    s.node("acct")
    s.node("indexer")

render(g, "03-capital-flow")
