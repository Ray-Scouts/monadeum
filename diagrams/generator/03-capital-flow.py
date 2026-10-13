"""
Monadeum - 03 Capital flow: where an owner's capital can and cannot go.

Claim: capital enters only from the owner and can leave the account only to listed places.

Derived from:
  ARCHITECTURE.md section 3 (capital flow), section 6.1 (funding flow, principal
                    from indexed transfers), section 7 (gasless onboarding, paymaster)
  ARCHITECTURE.md section 16.3 (recipient rule, x402 bound), 16.5 (reallocation
                    between accounts of one owner)
  EVOLUTION.md sections 3.2, 3.3, 6 (no treasury, conservation, retirement moves nothing)
  THREAT-MODEL.md invariants 3, 11, 13, 15

Status on 2026-10-13: the Privy wallet, the Kernel account, and sponsored gas ran
on testnet. No relayed funding transfer has been executed (ring), the card
on-ramp is not built (dashed), and spend limits have not yet been observed
rejecting a transfer on testnet (ring).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from toolkit import Diagram, OBSERVED, BUILT, DESIGN, build

d = Diagram(
    "03-capital-flow",
    title="Capital enters from the owner and leaves only to listed places",
    subtitle="The agent account is the custody boundary. Nothing here creates capital.",
    desc=("Capital flow in two bands. Funding: an owner wallet signs, a relayer submits, the agent account "
          "receives. Spending: the account may swap on the Kuru router, pay listed x402 payees, and pay gas; "
          "any other address is rejected on chain."),
    cols=4, gutter=100, rows=2, gaps={0: 52, 1: 120},
)
d.zone("Funding", rows=(0, 0))
d.node("ramp", "Card on-ramp", "Not built", 0, 0, status=DESIGN)
d.node("wallet", "Owner wallet", "Signs the allocation", 1, 0, status=OBSERVED)
d.node("relay", "Relayer", "Pays gas, EIP-3009", 2, 0, status=BUILT)
d.node("acct", "Agent account", "Sole custody boundary", 3, 0, status=OBSERVED, kind="accent")
d.node("kuru", "Kuru swaps", "Allowlisted router only", 0, 1, status=BUILT)
d.node("x402", "x402 payees", "Listed payees, bounded", 1, 1, status=BUILT)
d.node("gas", "Gas", "Sponsored, then own", 2, 1, status=OBSERVED)
d.node("other", "Other address", "Reverts on chain", 3, 1, status=BUILT, kind="bad")
d.edge("ramp", "wallet", "card", dashed=True)
d.edge("wallet", "relay", "signs")
d.edge("relay", "acct", "USDC")
d.edge("acct", "kuru", "capped", kind="good", lseg=2, so=-45)
d.edge("acct", "x402", "capped", kind="good", lseg=2, so=-45)
d.edge("acct", "gas", "budgeted", kind="good", lseg=2, so=-45)
d.edge("acct", "other", "refused", kind="bad", lpos=0.5, so=45, to=45)

if __name__ == "__main__":
    build(d, "03-capital-flow")
