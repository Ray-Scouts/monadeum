/**
 * Monad testnet (chain 10143) as docs.monad.xyz lists it on 2026-10-12: two block explorers, MonadVision
 * (https://testnet.monadvision.com) and Monadscan (https://testnet.monadscan.com), and the public RPC below. The
 * evidence page links Monadscan.
 */
export const CHAIN_ID = 10143;
export const EVIDENCE_RPC = "https://testnet-rpc.monad.xyz";
export const EVIDENCE_EXPLORER = "https://testnet.monadscan.com";

export const txLink = (hash: string) => `${EVIDENCE_EXPLORER}/tx/${hash}`;
export const addressLink = (address: string) => `${EVIDENCE_EXPLORER}/address/${address}`;
export const blockLink = (block: string | number | bigint) => `${EVIDENCE_EXPLORER}/block/${block}`;

/** `0x1234abcd…ef5678`: the start and end of a long value, for display only. The full value stays in the link and the accessible name. */
export function middle(value: string, head = 8, tail = 6): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
