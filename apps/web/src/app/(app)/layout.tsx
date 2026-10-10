import type { ReactNode } from "react";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { ApiRoot } from "@/components/api/ApiRoot";
import { AccountChip, SignInGate } from "@/components/api/SignIn";
import { NavRail } from "@/components/NavRail";
import { ThemeToggle } from "@/components/ThemeToggle";
import { USES_API } from "@/data/config";
import { getSource } from "@/data/source";

function Frame({ live, account, children }: { live: number | null; account: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <NavRail live={live} cap={PROTOCOL.testnetPopulationCap} />
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-end gap-3 border-b border-line-soft bg-[color-mix(in_srgb,var(--bg)_86%,transparent)] px-4 py-3.5 backdrop-blur-md md:px-8">
          <span title="Current operating mode" className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px]">
            <span className="size-2 rounded-full bg-warn shadow-[0_0_0_4px_var(--warn-wash)]" />
            Testnet
          </span>
          {account}
          <ThemeToggle />
        </header>
        <main className="flex w-full max-w-[1360px] flex-col gap-5 px-4 pt-7 pb-28 md:px-8 md:pb-16">{children}</main>
      </div>
    </div>
  );
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (USES_API) {
    // The API's population endpoint serves platform counts, not a live count per the cap, so the rail omits it.
    return (
      <ApiRoot>
        <Frame live={null} account={<AccountChip />}>
          <SignInGate>{children}</SignInGate>
        </Frame>
      </ApiRoot>
    );
  }
  const agents = await getSource().listAgents();
  const live = agents.filter((a) => a.status !== "retired").length;
  return (
    <Frame
      live={live}
      account={
        <span title="Your embedded wallet (sample)" className="inline-flex items-center gap-2 rounded-full border border-line-soft bg-surface-2 py-1 pr-3 pl-1 font-mono text-[13px]">
          <span className="size-6 rounded-full bg-[conic-gradient(from_30deg,var(--accent),var(--berry),var(--mint),var(--accent))]" />
          <span className="hidden sm:inline">0x4f2a…91c3</span>
        </span>
      }
    >
      {children}
    </Frame>
  );
}
