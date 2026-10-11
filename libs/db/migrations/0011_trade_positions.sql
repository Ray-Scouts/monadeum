-- TradingModule's per-agent positions (ARCHITECTURE.md section 10, TradingModule, "Positions and realized P&L"), with
-- their grants. Same rules as 0001: the module-shaped record is kept whole in `body` (encoded by @monadeum/db with
-- bigints tagged).

-- One row per agent: open size, basis, cumulative realized P&L, the close in flight, and the trade keys already
-- settled into it. Replaced whole on every write; the worker writes one agent's position from one tick at a time.
CREATE TABLE trade_positions (
  agent_id  text PRIMARY KEY,
  body      jsonb NOT NULL
);

-- The worker reads and writes positions and deletes nothing; the reader may read them.
REVOKE ALL ON trade_positions FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON trade_positions TO monadeum_worker;
GRANT SELECT ON trade_positions TO monadeum_reader;
