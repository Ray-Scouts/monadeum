import { createPublicClient, hexToBigInt, http, numberToHex, type Address, type Hex, type PublicClient } from "viem";
import { monadTestnet } from "viem/chains";
import type { BlockRef, IndexerChain, LogQuery, RawLog } from "./types.js";

interface RpcLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  logIndex: Hex | null;
  removed?: boolean;
}

/** `IndexerChain` over a JSON-RPC endpoint, through viem. Reads only: the indexer never signs or sends. */
export class ViemIndexerChain implements IndexerChain {
  private readonly client: PublicClient;

  constructor(rpcUrl: string | undefined) {
    this.client = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl) });
  }

  chainId(): Promise<number> {
    return this.client.getChainId();
  }

  headBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber({ cacheTime: 0 });
  }

  async finalizedBlockNumber(): Promise<bigint | null> {
    const block = await this.client.request({ method: "eth_getBlockByNumber", params: ["finalized", false] });
    return block?.number ? hexToBigInt(block.number) : null;
  }

  async block(number: bigint): Promise<BlockRef | null> {
    const block = await this.client.request({ method: "eth_getBlockByNumber", params: [numberToHex(number), false] });
    if (!block || !block.hash) return null;
    return { number, hash: block.hash, parentHash: block.parentHash };
  }

  async logs(query: LogQuery): Promise<RawLog[]> {
    const raw = (await this.client.request({
      method: "eth_getLogs",
      params: [{ address: query.address, topics: query.topics, fromBlock: numberToHex(query.fromBlock), toBlock: numberToHex(query.toBlock) }],
    })) as RpcLog[];
    const out: RawLog[] = [];
    for (const log of raw) {
      // Pending or removed logs carry no reliable position; the confirmed range should never return them.
      if (log.removed || !log.blockNumber || !log.blockHash || !log.transactionHash || log.logIndex === null) continue;
      out.push({
        address: log.address.toLowerCase() as Address,
        topics: log.topics,
        data: log.data,
        blockNumber: hexToBigInt(log.blockNumber),
        blockHash: log.blockHash,
        transactionHash: log.transactionHash,
        logIndex: Number(hexToBigInt(log.logIndex)),
      });
    }
    return out;
  }
}
