"""
Monadeum - 01 System architecture: services propose, the chain decides.

Claim: the off-chain services only propose actions; the contracts on Monad
enforce the limits whatever the services do.

Derived from:
  ARCHITECTURE.md section 2   (component diagram)
  ARCHITECTURE.md section 10  (backend: API, indexer, public evidence endpoint,
                               deployment on testnet)
  ARCHITECTURE.md section 11  (worker and tick runner, off by default)
  ARCHITECTURE.md section 16.3 and 16.5 (spend policy, reallocation contract)
  THREAT-MODEL.md section 3   (trust boundaries)
  contracts/deployments/monad-testnet.json (AgentSpendPolicy, AgentReallocation
                               and X402PaymentValidator deployed 2026-10-11)

Status follows the documents on 2026-10-13. Filled dot: the web app, Privy
sign-in, API, PostgreSQL, indexer, ZeroDev, the Kernel account and
AgentSpendPolicy ran on Monad testnet (the account deployment was indexed; a
spend validated through a bundler was not yet observed). Ring: the tick runner
is off by default, AgentReallocation is deployed with the switch off, and the
public evidence page is built with no recorded testnet observation of the page
itself. Dashed: the Kuru testnet market was not on chain on 2026-10-12.
Not drawn on purpose: X402PaymentValidator (diagram 07), AgentCommitments
(written, not deployed; diagram 06), the identity registry (not built).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from toolkit import Diagram, OBSERVED, BUILT, DESIGN, build

d = Diagram(
    "01-system-architecture",
    title="Services propose, the chain decides",
    subtitle="Where each part runs, and which path an action takes before capital moves.",
    desc=("System map in four bands: owner and browser, off-chain services, on-chain contracts. "
          "Reading: the tick runner sends an approved plan through ZeroDev to the agent account, "
          "where the spend policy contract checks it on chain."),
    cols=3, gutter=100, rows=6,
    gaps={0: 52, 1: 112, 2: 72, 3: 72, 4: 112, 5: 80},
)
d.zone("Owner and browser", rows=(0, 0))
d.zone("Off-chain services", rows=(1, 3))
d.zone("On-chain contracts on Monad", rows=(4, 5))

d.node("wallet", "Owner wallet", "Privy, third party", 1, 0, status=OBSERVED)
d.node("web", "Web app", "Owner signs in", 0, 0, status=OBSERVED)
d.node("evidence", "Evidence page", "Public, no sign-in", 2, 0, status=BUILT)

d.node("api", "API", "No agent loop", 0, 1, status=OBSERVED)
d.node("pg", "PostgreSQL", "Read-model, policies", 1, 1, status=OBSERVED)
d.node("indexer", "Indexer", "Finalized blocks only", 2, 1, status=OBSERVED)
d.node("tick", "Tick runner", "Off by default", 1, 2, status=BUILT, kind="accent")
d.node("zerodev", "ZeroDev", "Bundler, paymaster", 1, 3, status=OBSERVED, kind="accent")

d.node("spend", "Spend policy", "Caps, allowlist", 0, 4, status=OBSERVED, kind="accent")
d.node("acct", "Agent account", "Kernel v3.1", 1, 4, status=OBSERVED, kind="accent")
d.node("realloc", "Reallocation", "Deployed, switch off", 0, 5, status=BUILT)
d.node("kuru", "Kuru router", "No testnet market", 1, 5, status=DESIGN)

d.edge("web", "wallet", "signs", both=True)
d.edge("web", "api", "calls")
d.edge("evidence", "api", "reads", so=0, to=60)
d.edge("api", "pg", "stores", both=False)
d.edge("indexer", "pg", "writes")
d.edge("pg", "tick", "policies")
d.edge("tick", "zerodev", "approved plan only", kind="accent")
d.edge("zerodev", "acct", "user operation", kind="accent")
d.edge("acct", "spend", "checks", kind="good")
d.edge("acct", "indexer", "finalized logs", mode="hv")
d.edge("acct", "kuru", "swaps", dashed=True)
d.edge("acct", "realloc", "reallocates", mode="vhv", so=-60)

if __name__ == "__main__":
    build(d, "01-system-architecture")
