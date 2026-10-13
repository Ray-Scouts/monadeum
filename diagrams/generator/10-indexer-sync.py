"""
Monadeum - 10 Indexer sync: how chain events become a read-model.

Derived from:
  ARCHITECTURE.md section 10, "Current state (apps/indexer, issue #40)"
    (sync, finality, reorgs, what it indexes, pluggable handlers, read-model,
     writers and dependants, not yet indexed)
  ARCHITECTURE.md section 10, database layer entry (roles and grants, atomic apply)
  ARCHITECTURE.md section 6.1 (principal from indexed transfers)
  ARCHITECTURE.md section 11 (principal job)
  THREAT-MODEL.md invariants 16 and boundary 7

Verified on testnet on 2026-10-11: the indexer synced finalized batches and
recorded account.deployed, spend.limits-set, and spend.call-allowed rows for
the first agent. Sufficiency of Finalized (rather than Verified) is an
assumption recorded in ARCHITECTURE.md.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _style import *

g = new_graph(
    "indexer-sync",
    rankdir="TB",
    title="Indexer sync: one batch from the finalized head to the read-model",
    subtitle="The indexer is the only writer of chain-sourced rows. It reads only what the chain can no longer retract.",
    source="ARCHITECTURE.md sections 6.1, 10, 11; THREAT-MODEL.md invariant 16",
    ranksep="0.45",
    nodesep="0.6",
    newrank="true",
)

card(g, "head", "1  Read the finalized head",
     ["RPC tag finalized: irreversible without a hard fork,", "about two blocks (600 ms) behind the proposal"],
     kind="chain", status=IMPL)
card(g, "chk", "2  Compare the cursor hash with the chain",
     ["Kept in finalized mode as a guard against", "a node serving inconsistent data"], kind="service", status=IMPL)
card(g, "roll", "Mismatch: roll back",
     ["To the newest stored block hash still canonical;", "delete every row above it and re-index",
      "Deeper than the window: stop the process"], kind="bad", status=OFF)
card(g, "logs", "3  Fetch logs in a bounded batch",
     ["eth_getLogs, default 100 blocks, the smallest public range limit", "Polling, so one path handles gaps after a disconnect"],
     kind="service", status=IMPL)
card(g, "hand", "4  Decode with registered handlers",
     ["AgentSpendPolicy: LimitsSet, CallAllowed, Spent, TradedAssetSet",
      "EntryPoint v0.7 AccountDeployed; Kernel v3.1 permission and nonce events",
      "Settlement asset Transfer where from or to is a followed account"],
     kind="service", status=IMPL)
card(g, "follow", "Follow rule",
     ["An account is followed only if it first appears in a transaction",
      "that deployed it through the configured Kernel factory",
      "The factory is public: the API joins against its own agent records"],
     kind="control", status=IMPL)
card(g, "val", "5  Validate the batch",
     ["Logs must agree with canonical block hashes and extend the cursor;", "otherwise retry, store nothing"],
     kind="control", status=IMPL)
card(g, "apply", "6  Apply in one transaction",
     ["Rows, block hashes, tracked accounts, and the new cursor together", "Cursor flag finalized is true only while every batch used the finalized rule"],
     kind="neutral", status=IMPL)
card(g, "rm", "PostgreSQL read-model",
     ["Rows are decoded events; current state is projected as views,", "so a rollback never leaves a stale derived row"],
     kind="neutral", status=IMPL)

card(g, "api", "API", ["monadeum_reader, read only"], kind="service", status=IMPL)
card(g, "pj", "Worker principal job", ["SELECT only, up to the finalized bound", "Owner deposits minus withdrawals"],
     kind="service", status=OFF)
card(g, "nodep", "The worker never imports the indexer",
     ["A tick reads the agent record, not the read-model,", "so an indexer outage only delays a principal change"],
     kind="threat", status=IMPL)

card(g, "conf", "Alternative to step 1: confirmation depth",
     ["Explicit setting only, default 10 blocks below head", "Never an automatic fallback; cursor not marked finalized"],
     kind="neutral", status=OFF)
card(g, "later", "Handlers not yet added",
     ["Reallocation contract events (one more handler)", "Identity registry and genome hash commitments"],
     kind="neutral", status=DESIGN)

link(g, "head", "chk")
link(g, "chk", "roll", "mismatch", kind="danger")
link(g, "chk", "logs", "match", kind="gate")
link(g, "roll", "logs", "re-index", kind="flow", constraint="false")
link(g, "logs", "hand")
link(g, "hand", "follow", style="invis")
link(g, "hand", "val")
link(g, "val", "apply", "consistent", kind="gate")
link(g, "apply", "rm")
link(g, "rm", "api", "reads")
link(g, "rm", "pj", "reads", kind="control")
link(g, "pj", "nodep", style="invis")
link(g, "later", "hand", dashed=True, constraint="false")

for a, b in (("chk", "roll"), ("hand", "follow"), ("val", "later"), ("apply", "conf"), ("api", "pj"), ("rm", "nodep")):
    with g.subgraph() as sg:
        sg.attr(rank="same")
        sg.node(a)
        sg.node(b)

for n in ("head", "chk", "logs", "hand", "val", "apply", "rm"):
    g.node(n, group="m")

render(g, "10-indexer-sync")
