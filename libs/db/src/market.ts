import type { MidSample, MidSampleStore } from "@monadeum/trading";
import type { Hex } from "viem";
import type { Database } from "./database.js";

interface Row {
  market: string;
  tick: string;
  mid: string;
  block_number: string;
  block_timestamp: string;
}

const COLUMNS = "market, tick::text AS tick, mid::text AS mid, block_number::text AS block_number, block_timestamp::text AS block_timestamp";

const toSample = (r: Row): MidSample => ({
  market: r.market as Hex,
  tick: Number(r.tick),
  mid: BigInt(r.mid),
  blockNumber: BigInt(r.block_number),
  blockTimestamp: BigInt(r.block_timestamp),
});

/** `MidSampleStore` on Postgres (migration 0015). `record` is INSERT ... ON CONFLICT DO NOTHING, then a read back. */
export class PgMidSampleStore implements MidSampleStore {
  constructor(private readonly db: Database) {}

  async record(sample: MidSample): Promise<MidSample> {
    const market = sample.market.toLowerCase();
    await this.db.query(
      `INSERT INTO market_mid_samples (market, tick, mid, block_number, block_timestamp) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (market, tick) DO NOTHING`,
      [market, sample.tick, sample.mid.toString(), sample.blockNumber.toString(), sample.blockTimestamp.toString()],
    );
    const { rows } = await this.db.query<Row>(`SELECT ${COLUMNS} FROM market_mid_samples WHERE market = $1 AND tick = $2`, [market, sample.tick]);
    return toSample(rows[0]!);
  }

  async range(market: Hex, fromTick: number, toTick: number): Promise<MidSample[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM market_mid_samples WHERE market = $1 AND tick BETWEEN $2 AND $3 ORDER BY tick`,
      [market.toLowerCase(), fromTick, toTick],
    );
    return rows.map(toSample);
  }
}
