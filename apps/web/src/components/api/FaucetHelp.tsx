import { CopyButton } from "@/app/(app)/agents/[id]/_components/CopyButton";

export const CIRCLE_FAUCET_URL = "https://faucet.circle.com";

export const FAUCET_COPY = {
  title: "Need testnet USDC?",
  body: "The agent trades Circle's testnet USDC. Request it for free from Circle's faucet: choose Monad Testnet and USDC, paste the address below, then come back and fund the agent here.",
  link: "Open Circle's faucet",
  ownerLabel: "Your owner wallet (recommended)",
  ownerNote: "Funds sent here are moved to the agent with the signed transfer below, which is also what the platform records as the agent's principal.",
  agentLabel: "This agent's account",
  agentNote: "A direct send also reaches the agent. It is not verified here whether the platform counts a direct send as principal, so prefer the owner wallet.",
};

function AddressRow({ label, note, address }: { label: string; note: string; address: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="flex items-center gap-1">
        <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs">{address}</code>
        <CopyButton value={address} label={`Copy ${label.toLowerCase()}`} />
      </span>
      <span className="text-xs text-muted">{note}</span>
    </div>
  );
}

/** Where to get testnet USDC: the addresses to paste into Circle's faucet, copyable, and a link to the faucet. */
export function FaucetHelp({ owner, agentAddress }: { owner: string; agentAddress: string | null }) {
  return (
    <section aria-label={FAUCET_COPY.title} className="mt-3 flex flex-col gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
      <div>
        <h3 className="font-medium">{FAUCET_COPY.title}</h3>
        <p className="mt-1 text-[13px] text-muted">{FAUCET_COPY.body}</p>
      </div>
      <AddressRow label={FAUCET_COPY.ownerLabel} note={FAUCET_COPY.ownerNote} address={owner} />
      {agentAddress && <AddressRow label={FAUCET_COPY.agentLabel} note={FAUCET_COPY.agentNote} address={agentAddress} />}
      <a className="btn self-start" href={CIRCLE_FAUCET_URL} target="_blank" rel="noreferrer noopener">
        {FAUCET_COPY.link}
      </a>
    </section>
  );
}
