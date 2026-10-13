"""
Monadeum - 07 x402 payment flow: how an agent pays for information.

Derived from:
  ARCHITECTURE.md section 8     (x402 as an economic primitive, untrusted responses)
  ARCHITECTURE.md section 10    (X402Module: v2 transport, ValidatorPayer,
                                 reconcileSettlements)
  ARCHITECTURE.md section 16.3  ("x402 signature path": validator rules, slots,
                                 bounds, open questions)
  SECURITY.md sections 1, 5, 8, 12  (bounds, provider allowlist, fail closed,
                                 settlement matching)
  THREAT-MODEL.md scenarios C, E, I and invariant 17

The whole path is implemented and off: the worker's payer is disabled unless
WORKER_X402_PAYER_ENABLED is exactly true, the validator is installed on no
testnet account, and the production tick runner offers no information.
Whether the facilitator used on Monad accepts ERC-1271 signatures for
EIP-3009 is not verified (ARCHITECTURE.md section 16.3, open question 1).
That the providers serve x402 v2 on Monad is also an assumption.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _style import *

g = new_graph(
    "x402-payment-flow",
    rankdir="TB",
    title="x402 payment flow: every step before, during, and after a paid request",
    subtitle="The payer is off by default. An agent without the validator installed cannot pay at all, which is the intended fail-closed state.",
    source="ARCHITECTURE.md sections 8, 10, 16.3; SECURITY.md sections 1, 5, 12",
    ranksep="0.45",
    nodesep="0.7",
    newrank="true",
)

card(g, "s1", "1  Information request",
     ["RiskModule information check: the lower of", "the genome budget and the policy cap"],
     kind="control", status=OFF)
card(g, "s2", "2  Request to an allowlisted provider",
     ["Nansen or DeFiLlama only; no open discovery"], kind="service", status=OFF)
card(g, "s3", "3  Read HTTP 402 and PAYMENT-REQUIRED",
     ["v2 headers only; v1 fails closed as terms", "Payload must echo the chosen requirement"],
     kind="service", status=OFF)
card(g, "s4", "4  Claim a nonce slot, then sign",
     ["Slot claimed durably in x402_nonce_slots first", "No free slot or unlisted terms: no signature"],
     kind="service", status=OFF)
card(g, "s5", "5  Retry with PAYMENT-SIGNATURE",
     ["x402 key signs through ERC-1271", "No user operation, no transaction"],
     kind="service", status=OFF)
card(g, "s6", "6  Read PAYMENT-RESPONSE",
     ["Hash recorded only for success on the", "configured network by the paying account"],
     kind="service", status=OFF)
card(g, "s7", "7  Treat the response as untrusted",
     ["Schema-validated; malformed means no information", "Logged with provider, price, outcome"],
     kind="control", status=OFF)
card(g, "s8", "8  x402-reconcile job",
     ["Every 5 minutes by default; matches AuthorizationUsed", "and Transfer to a slot and a log entry",
      "Alerts: x402-settlement-unmatched or -mismatch"],
     kind="control", status=OFF)

card(g, "prov", "x402 provider", ["Serves x402 v2 on Monad:", "an assumption, not verified"],
     kind="external", status=DESIGN)
card(g, "val", "X402PaymentValidator",
     ["Payee is on the owner's list", "0 < value <= 0.05 USDC, 0 < validity <= 300 s",
      "Slot below 4 per hour", "Digest recomputed with from = the account;", "a permit or other typed data cannot match"],
     kind="chain", status=OFF)
card(g, "fac", "Facilitator verifies and settles",
     ["transferWithAuthorization on USDC,", "each nonce accepted once", "ERC-1271 acceptance on Monad: open question 1"],
     kind="external", status=DESIGN)
card(g, "bound", "Worst case on chain",
     ["26 x 4 x 0.05 = 5.20 USDC per agent per 24 h", "A budget separate from the daily cap"],
     kind="threat", status=OFF)

link(g, "s1", "s2", kind="control")
link(g, "s2", "s3", "GET, then 402")
link(g, "s3", "s4", kind="control")
link(g, "s4", "s5", "signature")
link(g, "s5", "s6", "settled")
link(g, "s6", "s7")
link(g, "s7", "s8")

link(g, "s2", "prov", "request", dir="both", dashed=True)
link(g, "s4", "val", "ERC-1271 check", kind="gate", dir="both")
link(g, "s5", "fac", "payload", dashed=True)
link(g, "fac", "s6", dashed=True, constraint="false")
link(g, "val", "bound", style="invis")
link(g, "s8", "bound", style="invis")

for a, b in (("s2", "prov"), ("s4", "val"), ("s5", "fac"), ("s7", "bound")):
    with g.subgraph() as sg:
        sg.attr(rank="same")
        sg.node(a)
        sg.node(b)

for n in ("s1","s2","s3","s4","s5","s6","s7","s8"):
    g.node(n, group="m")

render(g, "07-x402-payment-flow")
