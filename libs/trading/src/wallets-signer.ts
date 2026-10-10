import type { TickExecuteResult, TickStatus, WalletsService } from "@monadeum/wallets";
import type { Hex } from "viem";
import { SignerRejected, type Call, type OperationStatus, type TradeSigner } from "./types.js";

/** The part of WalletsService this adapter uses. */
export type TickExecutor = Pick<WalletsService, "executeForTick" | "lookupTick" | "agentIdOf">;

/**
 * TradeSigner on top of WalletsModule's tick-keyed execution (issue #24). WalletsModule records each operation's hash
 * under (agent, tick key) before submitting it, so `lookup` answers from that record, the bundler, and the chain, even
 * when TradingService never received a reference (crash between send and record). The adapter holds no key.
 *
 * `gasCostWei` is the operation's actual gas cost whether or not the paymaster sponsored it, so an agent's trading
 * costs do not depend on how much of its sponsorship budget is left.
 */
export class WalletsTradeSigner implements TradeSigner {
  constructor(private readonly wallets: TickExecutor) {}

  async submit(request: { tickKey: string; account: Hex; calls: Call[] }): Promise<{ ref: Hex }> {
    const agentId = await this.agentId(request.account);
    if (!agentId) throw new SignerRejected(`no agent wallet for account ${request.account}`);
    const result: TickExecuteResult = await this.wallets.executeForTick({
      agentId,
      tickKey: request.tickKey,
      calls: request.calls.map((c) => ({ to: c.target, value: 0n, data: c.data })),
    });
    if (result.ok) return { ref: result.userOpHash };
    // Pending, or an outcome WalletsModule cannot confirm: the operation may land, so report it, never reject.
    if (result.userOpHash) return { ref: result.userOpHash };
    if (result.reason === "submission-unknown") throw new Error(`submission outcome unknown: ${result.detail ?? "no detail"}`);
    // Every other reason means nothing was submitted for this call.
    throw new SignerRejected(result.detail ? `${result.reason}: ${result.detail}` : result.reason);
  }

  async lookup(request: { tickKey: string; account: Hex; ref: Hex | null }): Promise<OperationStatus> {
    const agentId = await this.agentId(request.account);
    if (!agentId) throw new Error(`no agent wallet for account ${request.account}`);
    // Throws when WalletsModule cannot tell; TradingService treats that as a network failure and keeps the tick claimed.
    const status: TickStatus = await this.wallets.lookupTick(agentId, request.tickKey);
    // Absent even with a reported reference: every attempt is provably dead, so TradingService may resubmit, and
    // WalletsModule reuses the dead attempt's nonce. The reference returned below can differ from `request.ref` when
    // a re-attempt replaced it; only one of them can ever be included.
    if (status.state === "absent") return { state: "absent" };
    if (status.state === "pending") return { state: "pending", ref: status.userOpHash };
    const r = status.receipt;
    return {
      state: "included",
      ref: status.userOpHash,
      receipt: {
        success: r.success,
        transactionHash: r.transactionHash,
        blockNumber: r.blockNumber,
        gasCostWei: r.actualGasCost,
        logs: r.logs.map((l) => ({ address: l.address, topics: [...l.topics], data: l.data })),
        revertReason: r.revertReason,
      },
    };
  }

  private agentId(account: Hex): Promise<string | undefined> {
    return this.wallets.agentIdOf(account);
  }
}
