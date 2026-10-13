"""
Monadeum - 01 System architecture: which processes and contracts exist.

Derived from:
  ARCHITECTURE.md section 2  (component diagram)
  ARCHITECTURE.md section 10 (backend architecture, API, indexer, deployment on testnet)
  ARCHITECTURE.md section 11 (worker architecture, tick runner)
  ARCHITECTURE.md section 16.3 and 16.5 (on-chain contracts and their deployment state)
  THREAT-MODEL.md section 3 (trust boundaries 1, 2, 7)

Status shown follows the state recorded in those sections on 2026-10-12: the
web app, API, indexer, Postgres, the Kernel account, and AgentSpendPolicy ran
on Monad testnet (account deployment indexed); the tick runner, the x402
payer, and reallocation are implemented but off; the identity registry and
LLM reasoning are not built.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _style import *

g = new_graph(
    "system-architecture",
    rankdir="TB",
    title="System architecture: what runs, what is on chain, and who may write what",
    subtitle="Monad testnet deployment, one VPS. The worker never depends on the indexer; the API never runs an agent loop.",
    source="ARCHITECTURE.md sections 2, 10, 11, 16.3, 16.5",
    nodesep="0.3",
    ranksep="0.7",
    newrank="true",
)

# --------------------------------------------------------------- left column
card(g, "web", "Web app", ["Next.js, owner signs in"], kind="service", status=IMPL)
card(g, "privy", "Privy", ["embedded wallet, owner", "of every agent account"], kind="external", status=IMPL)
card(g, "api", "API", ["NestJS + Fastify", "no agent loop"], kind="service", status=IMPL)
card(g, "pg", "PostgreSQL", ["read-model, module stores,", "signed risk policies"], kind="neutral", status=IMPL)
card(g, "indexer", "Indexer", ["finalized blocks only"], kind="service", status=IMPL)

# ------------------------------------------------------------- worker spine
card(g, "redis", "Redis / BullMQ", ["one tick job per", "agent per hour"], kind="neutral", status=OFF)
card(g, "llm", "LLM reasoning", ["not in the repository"], kind="service", status=DESIGN)
card(g, "strategy", "Strategy plugin", ["trailing-mean signal"], kind="service", status=OFF)
card(g, "x402c", "x402 client", ["payer off: signs nothing"], kind="service", status=OFF)
card(g, "risk", "RiskModule", ["signed policy,", "in-process library"], kind="control", status=OFF)
card(g, "trading", "TradingModule", ["builds calldata,", "never signs or sends"], kind="service", status=OFF)
card(g, "prov", "x402 providers", ["Nansen, DeFiLlama"], kind="external", status=DESIGN)
card(g, "zerodev", "ZeroDev", ["bundler + paymaster"], kind="external", status=IMPL)

# -------------------------------------------------------------------- chain
card(g, "acct", "Agent account", ["Kernel v3.1, one per agent,", "owned by the user's wallet"], kind="chain", status=IMPL)
card(g, "spend", "AgentSpendPolicy", ["caps, allowlist,", "recipient rule"], kind="chain", status=IMPL)
card(g, "x402v", "X402PaymentValidator", ["deployed, installed", "on no account"], kind="chain", status=OFF)
card(g, "realloc", "AgentReallocation", ["deployed, off"], kind="chain", status=OFF)
card(g, "reg", "Identity registry", ["ERC-8004 compatible"], kind="chain", status=DESIGN)
card(g, "kuru", "Kuru router", ["testnet market not", "on chain 2026-10-12"], kind="external", status=DESIGN)

for grp in (("web", "privy", "redis"), ("api", "strategy", "llm"), ("pg", "risk", "x402c"),
            ("indexer", "trading", "prov"), ("zerodev",), ("x402v", "acct", "kuru"),
            ("spend", "realloc", "reg")):
    with g.subgraph() as s:
        s.attr(rank="same")
        for n in grp:
            s.node(n)

# --------------------------------------------------------------------- edges
link(g, "web", "api", "bearer token or\nHttpOnly cookie", kind="control")
link(g, "web", "privy", "wallet signatures", dir="both")
link(g, "privy", "api", "identity token", kind="control")
link(g, "api", "pg", "role monadeum_api")
link(g, "api", "zerodev", "owner-signed deploy,\nactivate, revoke", kind="control", constraint="false")
link(g, "pg", "indexer", "sole writer", dir="back")

link(g, "redis", "strategy", "tick job")
link(g, "llm", "strategy", dashed=True)
link(g, "strategy", "risk", "proposal only", kind="control")
link(g, "x402c", "risk", "information check", kind="control")
link(g, "risk", "trading", "approved plan only", kind="gate")
link(g, "x402c", "prov", "HTTP 402", dashed=True)
link(g, "trading", "zerodev", "session key", kind="control")
link(g, "zerodev", "acct", "ERC-4337 operation")
link(g, "acct", "kuru", "approve + swap", kind="chain", dashed=True)
link(g, "acct", "spend", "validate +\nhook", kind="gate")
link(g, "x402v", "acct", "x402 key,\nERC-1271", kind="gate", dashed=True)
link(g, "acct", "realloc", "approve + reallocate", kind="chain", dashed=True)
link(g, "acct", "reg", kind="chain", dashed=True)
link(g, "acct", "indexer", "finalized logs", kind="chain", constraint="false")

render(g, "01-system-architecture")
