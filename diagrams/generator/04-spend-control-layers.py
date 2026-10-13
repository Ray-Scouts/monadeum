"""
Monadeum - 04 Spend control layers: who checks an action, and when.

Claim: every spend is checked twice, off chain and on chain, before capital moves.

Derived from:
  SECURITY.md section 1 (on-chain spend policy), section 4 (a proposal is not an
                authorization), section 9 (layered caps, population circuit breaker
                as implemented), section 13 (known limitations)
  ARCHITECTURE.md section 16.1 (RiskModule rules) and 16.3 (validation versus
                execution phase, rolling daily window)
  THREAT-MODEL.md invariants 1, 7, 11, 17

Status on 2026-10-13: the spend policy is deployed on Monad testnet and installed on
the first agent account, and not audited. No spending operation validated by it
through a bundler has been observed (SECURITY.md section 13), so every check is a
ring. The population circuit breaker is built and tested offline.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from toolkit import Diagram, OBSERVED, BUILT, DESIGN, build

d = Diagram(
    "04-spend-control-layers",
    title="Every spend is checked twice before capital moves",
    subtitle="A proposal has no authority. The chain does not trust the off-chain engine.",
    desc=("Spend control as a vertical path: a proposal passes the RiskModule off chain, then the spend "
          "policy validation and the daily cap record on chain, and only then does capital move. "
          "Each check has a refusal branch, and a circuit breaker can halt all proposals."),
    cols=4, gutter=100, rows=5, gaps={0: 52, 1: 60, 2: 112, 3: 60, 4: 60},
)
d.zone("Check 1, off chain", rows=(0, 1))
d.zone("Check 2, on chain", rows=(2, 4))
d.node("prop", "Proposal", "Strategy output, no authority", 0, 0, span=2, status=BUILT)
d.node("breaker", "Circuit breaker", "Halts every tick", 3, 0, status=BUILT)
d.node("risk", "RiskModule", "Signed policy, plan hash", 0, 1, span=2, status=BUILT, kind="accent")
d.node("refused", "Refused", "Nothing sent, logged", 3, 1, status=BUILT, kind="bad")
d.node("val", "Spend policy", "Allowlist, recipient, per-tx cap", 0, 2, span=2, status=BUILT, kind="accent")
d.node("invalid", "Invalid", "No gas paid", 3, 2, status=BUILT, kind="bad")
d.node("cap", "Daily cap", "Rolling 24 hours, recorded", 0, 3, span=2, status=BUILT, kind="accent")
d.node("revert", "Reverts", "Gas is still paid", 3, 3, status=BUILT, kind="bad")
d.node("move", "Capital moves", "Only inside both limits", 0, 4, span=2, status=BUILT, kind="good")
d.edge("breaker", "prop", "halts ticks", kind="bad")
d.edge("prop", "risk", "proposes", kind="accent")
d.edge("risk", "val", "approved plan only", kind="good")
d.edge("val", "cap", "valid operation", kind="good")
d.edge("cap", "move", "within caps", kind="good")
d.edge("risk", "refused", "any violation", kind="bad")
d.edge("val", "invalid", "any violation", kind="bad")
d.edge("cap", "revert", "over daily cap", kind="bad")

if __name__ == "__main__":
    build(d, "04-spend-control-layers")
