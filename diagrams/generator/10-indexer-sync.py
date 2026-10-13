"""
Monadeum - 10 Indexer sync: how chain events become a read-model.

Claim: only finalized blocks reach the read-model.

Derived from:
  ARCHITECTURE.md section 10, "Current state (apps/indexer)" (sync, finality,
                  reorgs, handlers, read-model, writers and readers, not yet
                  indexed) and the database layer entry (roles, atomic apply)
  ARCHITECTURE.md section 6.1 (principal from indexed transfers), section 11
  THREAT-MODEL.md invariant 16 and boundary 7

Status on 2026-10-13: on 2026-10-11 the indexer synced finalized batches and
recorded account.deployed, spend.limits-set, and spend.call-allowed rows for the
first agent (filled). Rollback has not been exercised on testnet. The
reallocation handlers load only with INDEXER_REALLOCATION_ADDRESS set and are
covered by in-memory tests only (ring). The principal job is built and off with
the worker. Sufficiency of Finalized over Verified is an assumption recorded in
ARCHITECTURE.md.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from toolkit import Diagram, OBSERVED, BUILT, DESIGN, build

d = Diagram(
    "10-indexer-sync",
    title="Only finalized blocks reach the read-model",
    subtitle="The indexer is the only writer of chain-sourced rows.",
    desc=("One indexer batch as a vertical path: read the finalized head, fetch logs, decode them with "
          "registered handlers, validate the batch against canonical block hashes, apply it in one "
          "transaction, and serve readers from PostgreSQL. A mismatch rolls back."),
    cols=4, gutter=100, rows=6, gaps={0: 0, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60},
)
d.node("head", "Finalized head", "Irreversible without a hard fork", 0, 0, span=2, status=OBSERVED, kind="accent")
d.node("fetch", "Fetch logs", "Bounded batch, polling", 0, 1, span=2, status=OBSERVED)
d.node("decode", "Decode", "Registered handlers", 0, 2, span=2, status=OBSERVED)
d.node("validate", "Validate", "Hashes agree with cursor", 0, 3, span=2, status=OBSERVED)
d.node("apply", "Apply", "Rows and cursor together", 0, 4, span=2, status=OBSERVED)
d.node("pg", "PostgreSQL", "Read-model, views", 0, 5, span=2, status=OBSERVED)
d.node("handlers", "Reallocation", "Opt-in handlers", 3, 2, status=BUILT)
d.node("rollback", "Roll back", "Back to canonical", 3, 3, status=BUILT, kind="bad")
d.node("api", "API", "Read-only role", 3, 4, status=OBSERVED)
d.node("job", "Principal job", "Deposits, withdrawals", 3, 5, status=BUILT)
d.edge("head", "fetch", "100 blocks")
d.edge("fetch", "decode", "raw logs")
d.edge("decode", "validate", "events")
d.edge("validate", "apply", "consistent", kind="good")
d.edge("apply", "pg", "one transaction")
d.edge("handlers", "decode", "registers")
d.edge("validate", "rollback", "mismatch", kind="bad")
d.edge("pg", "api", "reads", mode="hvh", mid=d.gutter_x(1, 0.5) + 150, lseg=2)
d.edge("pg", "job", "reads", lpos=0.85)

if __name__ == "__main__":
    build(d, "10-indexer-sync")
