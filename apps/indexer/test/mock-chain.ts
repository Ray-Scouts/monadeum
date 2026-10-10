import { encodeAbiParameters, encodeEventTopics, keccak256, type AbiEvent, type Address, type Hex } from "viem";
import type { BlockRef, IndexerChain, LogQuery, RawLog } from "../src/types.js";

export interface LogSpec {
  address: Address;
  event: AbiEvent;
  args: Record<string, unknown>;
  /** Transaction label. Logs of one block with the same label (default: none) share a transaction hash. */
  tx?: string;
}

interface MockBlock extends BlockRef {
  logs: RawLog[];
}

/** An in-memory chain whose blocks can be replaced from any height, to model a reorg. */
export class MockChain implements IndexerChain {
  blocks: MockBlock[] = [];
  calls = { logs: 0 };
  /** Blocks between the head and the `finalized` tag; null makes the node report no finalized block. */
  finalityLag: number | null = 2;
  /** Overrides what `block()` returns, to simulate a reorg racing a batch. */
  blockOverride: ((n: bigint) => BlockRef | null | undefined) | null = null;

  constructor(
    readonly id = 10143,
    private readonly fork = "a",
  ) {
    this.mine(1);
  }

  /** Appends `count` blocks; `logs[i]` are the logs of the i-th new block. */
  mine(count: number, logs: LogSpec[][] = [], fork = this.fork): this {
    for (let i = 0; i < count; i++) {
      const number = BigInt(this.blocks.length);
      const parentHash = number === 0n ? (`0x${"0".repeat(64)}` as Hex) : this.blocks[Number(number) - 1]!.hash;
      const hash = keccak256(toBytes(`${fork}:${number}:${parentHash}`));
      const block: MockBlock = { number, hash, parentHash, logs: [] };
      block.logs = (logs[i] ?? []).map((spec, logIndex) => encodeLog(spec, block, logIndex));
      this.blocks.push(block);
    }
    return this;
  }

  /** Drops every block from `height` up, then mines replacements on another fork. */
  reorg(height: number, count: number, logs: LogSpec[][] = [], fork = "b"): this {
    this.blocks = this.blocks.slice(0, height);
    return this.mine(count, logs, fork);
  }

  async chainId(): Promise<number> {
    return this.id;
  }

  async headBlockNumber(): Promise<bigint> {
    return BigInt(this.blocks.length - 1);
  }

  async finalizedBlockNumber(): Promise<bigint | null> {
    if (this.finalityLag === null) return null;
    const n = BigInt(this.blocks.length - 1 - this.finalityLag);
    return n < 0n ? 0n : n;
  }

  async block(number: bigint): Promise<BlockRef | null> {
    const override = this.blockOverride?.(number);
    if (override !== undefined && override !== null) return override;
    const b = this.blocks[Number(number)];
    return b ? { number: b.number, hash: b.hash, parentHash: b.parentHash } : null;
  }

  async logs(query: LogQuery): Promise<RawLog[]> {
    this.calls.logs++;
    const out: RawLog[] = [];
    const addresses = query.address.map((a) => a.toLowerCase());
    for (const b of this.blocks) {
      if (b.number < query.fromBlock || b.number > query.toBlock) continue;
      for (const log of b.logs) {
        if (!addresses.includes(log.address)) continue;
        const match = query.topics.every((accepted, i) => accepted === null || (log.topics[i] !== undefined && accepted.map((t) => t.toLowerCase()).includes(log.topics[i]!.toLowerCase())));
        if (match) out.push(log);
      }
    }
    return out;
  }
}

function toBytes(text: string): Hex {
  return `0x${Buffer.from(text, "utf8").toString("hex")}`;
}

export function encodeLog(spec: LogSpec, block: BlockRef, logIndex: number): RawLog {
  const indexed = spec.event.inputs.filter((i) => i.indexed);
  const plain = spec.event.inputs.filter((i) => !i.indexed);
  const topics = encodeEventTopics({
    abi: [spec.event],
    eventName: spec.event.name,
    args: Object.fromEntries(indexed.map((i) => [i.name!, spec.args[i.name!]])),
  } as never) as Hex[];
  const data = encodeAbiParameters(plain, plain.map((i) => spec.args[i.name!]));
  return {
    address: spec.address.toLowerCase() as Address,
    topics,
    data,
    blockNumber: block.number,
    blockHash: block.hash,
    transactionHash: keccak256(toBytes(`tx:${block.hash}:${spec.tx ?? ""}`)),
    logIndex,
  };
}
