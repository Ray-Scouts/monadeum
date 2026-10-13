"""
Monadeum - 09 Trust boundaries: where a claim stops being believed.

Claim: every layer re-checks what the layer before it claims.

Derived from:
  THREAT-MODEL.md section 3 (trust boundaries B1 to B10), section 7 (invariants
                  2, 7, 11, 13, 17), section 9 (the operator is trusted for the MVP)
  SECURITY.md sections 1, 4, 5 and ARCHITECTURE.md sections 7, 9, 16.3, 16.5

Status on 2026-10-13: the account and spend policy are deployed on testnet, with
spend validation not yet observed. The reallocation contract is deployed with the
switch off. Untrusted actors carry no status marker. The B-numbers are in the page
caption; the figure keeps only the plain words.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from toolkit import Diagram, OBSERVED, BUILT, DESIGN, build

d = Diagram(
    "09-trust-boundaries",
    title="Every layer re-checks what the layer before it claims",
    subtitle="The platform is trusted for the MVP. The chain enforces its rules regardless.",
    desc=("Three bands: untrusted input, the platform, and Monad. The browser and provider responses are "
          "re-validated by the platform, the strategy's proposal is checked by the RiskModule, and the "
          "chain re-checks the approved plan and rejects any other address."),
    cols=4, gutter=100, rows=4, gaps={0: 52, 1: 112, 2: 112, 3: 110},
)
d.zone("Untrusted input", rows=(0, 0))
d.zone("Platform", rows=(1, 1))
d.zone("Monad, enforces its rules", rows=(2, 3))
d.node("browser", "Browser", "Captures intent only", 0, 0, status=OBSERVED)
d.node("provider", "Provider data", "Live, untrusted input", 1, 0, status=DESIGN)
d.node("gift", "Incoming transfer", "Token or NFT sent in", 3, 0)
d.node("api", "API", "Re-derives ownership", 0, 1, status=OBSERVED)
d.node("strategy", "Strategy", "A proposal only", 1, 1, status=BUILT)
d.node("risk", "RiskModule", "Checks signed policy", 2, 1, status=BUILT, kind="accent")
d.node("owner", "Owner wallet", "Revokes any key", 0, 2, status=OBSERVED)
d.node("acct", "Agent account", "Spend policy, allowlist", 2, 2, status=OBSERVED, kind="accent")
d.node("realloc", "Reallocation", "Same owner only", 2, 3, status=BUILT)
d.node("other", "Other address", "Not on the allowlist", 3, 3, kind="bad")
d.edge("browser", "api", "re-validated", so=60, to=60)
d.edge("provider", "strategy", "schema-checked", dashed=True)
d.edge("strategy", "risk", "intent")
d.edge("risk", "acct", "approved plan", kind="accent")
d.edge("gift", "acct", "no new power", kind="bad", mid=d.gap_y(1), to=60)
d.edge("owner", "acct", "can revoke")
d.edge("acct", "realloc", "moves", lpos=0.5)
d.edge("acct", "other", "rejected", kind="bad", so=60, lseg=2)

if __name__ == "__main__":
    build(d, "09-trust-boundaries")
