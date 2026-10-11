import type { ReactNode } from "react";
import { AppFrame } from "@/components/AppFrame";
import { AppGate } from "@/components/api/gate";
import { AccountChip } from "@/components/api/SignIn";
import { USES_API } from "@/data/config";
import { getSource } from "@/data/source";

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (USES_API) {
    // The session lives in the root layout. The gate renders the frame only once the API confirms a session, so a
    // visitor who is not signed in sees neither the navigation nor any screen. The API's population endpoint serves
    // platform counts, not a live count per the cap, so the rail omits it.
    return (
      <AppGate>
        <AppFrame live={null} account={<AccountChip />}>
          {children}
        </AppFrame>
      </AppGate>
    );
  }
  const agents = await getSource().listAgents();
  const live = agents.filter((a) => a.status !== "retired").length;
  return (
    <AppFrame
      live={live}
      account={
        <span title="Your embedded wallet (sample)" className="inline-flex items-center gap-2 rounded-full border border-line-soft bg-surface-2 py-1 pr-3 pl-1 font-mono text-[13px]">
          <span className="size-6 rounded-full bg-[conic-gradient(from_30deg,var(--accent),var(--berry),var(--mint),var(--accent))]" />
          <span className="hidden sm:inline">0x4f2a…91c3</span>
        </span>
      }
    >
      {children}
    </AppFrame>
  );
}
