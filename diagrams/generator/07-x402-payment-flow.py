"""
Monadeum - 07 x402 payment flow: how an agent pays for information.

Claim: an agent can pay only a listed payee, within bounds the chain enforces.

Derived from:
  ARCHITECTURE.md section 8 (x402 as an economic primitive, untrusted responses),
                  section 10 (X402Module), section 16.3 (x402 signature path)
  SECURITY.md sections 1, 5, 8, 12 (bounds, provider allowlist, fail closed)
  THREAT-MODEL.md scenarios C, E, I and invariant 17

Status on 2026-10-13: the whole path is implemented and off. The payer is disabled
unless WORKER_X402_PAYER_ENABLED is true, the validator is deployed but installed
on no account, and the production tick runner offers no information. That the
providers serve x402 v2 on Monad, and that the facilitator accepts ERC-1271
signatures for EIP-3009 (ARCHITECTURE.md section 16.3, open question 1), are
assumptions, drawn dashed.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from toolkit import Diagram, OBSERVED, BUILT, DESIGN, build

d = Diagram(
    "07-x402-payment-flow",
    title="An agent can pay only a listed payee, within chain-enforced bounds",
    subtitle="The payer is off by default. Without the validator an agent cannot pay at all.",
    desc=("The x402 payment path as a vertical flow: check budget, request, sign, retry with payment, reconcile. "
          "The validator contract checks the signature on chain, a provider and a facilitator sit outside, "
          "and both are unverified assumptions."),
    cols=4, gutter=100, rows=5, gaps={0: 52, 1: 60, 2: 60, 3: 60, 4: 60},
)
d.zone("Worker", rows=(0, 4), cols=(0, 1))
d.zone("Outside the worker", rows=(0, 4), cols=(3, 3))
d.node("s1", "Check budget", "Lower of genome and policy", 0, 0, span=2, status=BUILT)
d.node("s2", "Request", "Allowlisted provider only", 0, 1, span=2, status=BUILT)
d.node("s3", "Sign payment", "Slot claimed first", 0, 2, span=2, status=BUILT, kind="accent")
d.node("s4", "Retry with payment", "Signature header, no transaction", 0, 3, span=2, status=BUILT)
d.node("s5", "Reconcile", "Match settlement, alert", 0, 4, span=2, status=BUILT)
d.node("prov", "Provider", "HTTP 402, v2 assumed", 3, 1, status=DESIGN)
d.node("val", "Validator", "Payee list, 0.05 USDC", 3, 2, status=BUILT, kind="good")
d.node("fac", "Facilitator", "ERC-1271 unverified", 3, 3, status=DESIGN)
d.edge("s1", "s2", "within budget")
d.edge("s2", "s3", "402 terms")
d.edge("s3", "s4", "signature")
d.edge("s4", "s5", "settled")
d.edge("s2", "prov", "request", both=True, dashed=True)
d.edge("s3", "val", "checks key", kind="good")
d.edge("s4", "fac", "settles", dashed=True)

if __name__ == "__main__":
    build(d, "07-x402-payment-flow")
