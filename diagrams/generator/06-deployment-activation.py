"""
Monadeum - 06 Deployment and activation: the owner signs every step.

Claim: the owner signs every step that gives an agent power.

Derived from:
  ARCHITECTURE.md section 6 (wallet and account architecture, session keys),
                  section 6.1 (funding flow), section 9 (genome commitment,
                  AgentCommitments), section 10 (API: create, activate, stop)
  SECURITY.md sections 1 and 2 (session key scope, ERC-1271)
  THREAT-MODEL.md invariants 2, 8, 11, 17

Status on 2026-10-13: on 2026-10-11 an owner signed in, created the first agent,
and its Kernel account was deployed with sponsored gas and indexed (filled).
Session key issuance through an embedded wallet and the relayed funding transfer
have not been run on testnet (ring). AgentCommitments is implemented and tested
but not deployed (ARCHITECTURE.md section 9), so the commit step is a ring.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from toolkit import Diagram, OBSERVED, BUILT, DESIGN, build

d = Diagram(
    "06-deployment-activation",
    title="The owner signs every step that gives an agent power",
    subtitle="Signing in deploys nothing. Activation does not by itself make an agent trade.",
    desc=("Activation as a vertical path: sign in, create the agent, deploy the account, activate a session key, "
          "fund, then ticks. The owner signs the deployment, the activation, and the funding. "
          "Side branches show the genome commitment at deployment and the stop that revokes the key."),
    cols=4, gutter=100, rows=6, gaps={0: 0, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60},
)
d.node("s1", "Sign in", "Privy login or wallet", 0, 0, span=2, status=OBSERVED)
d.node("s2", "Create agent", "Preset, caps, genome hash", 0, 1, span=2, status=OBSERVED)
d.node("s3", "Deploy account", "Sponsored gas, then indexed", 0, 2, span=2, status=OBSERVED, kind="accent")
d.node("s4", "Activate key", "Session key, spend policy", 0, 3, span=2, status=BUILT, kind="accent")
d.node("s5", "Fund", "Principal after indexing", 0, 4, span=2, status=BUILT, kind="accent")
d.node("s6", "Ticks", "Needs a policy and runner", 0, 5, span=2, status=BUILT)
d.node("commit", "Commitment", "Written, not deployed", 3, 2, status=BUILT)
d.node("stop", "Stop", "Key destroyed, revoked", 3, 3, status=BUILT, kind="bad")
d.edge("s1", "s2", "session")
d.edge("s2", "s3", "owner signs", kind="accent")
d.edge("s3", "s4", "owner signs", kind="accent")
d.edge("s4", "s5", "owner signs", kind="accent")
d.edge("s5", "s6", "indexed")
d.edge("s3", "commit", "commits hashes")
d.edge("s4", "stop", "revokes", kind="bad")

if __name__ == "__main__":
    build(d, "06-deployment-activation")
