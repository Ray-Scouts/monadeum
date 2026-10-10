"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, Logo, type IconName } from "./Icon";

const LINKS: { href: string; label: string; short?: string; icon: IconName }[] = [
  { href: "/population", label: "Population", icon: "population" },
  { href: "/capital-flow", label: "Capital flow", short: "Flow", icon: "flow" },
  { href: "/events", label: "Events", icon: "bolt" },
  { href: "/controls", label: "Controls", icon: "shield" },
  { href: "/create", label: "New agent", short: "New", icon: "plus" },
];

/** `live` is null when the data source does not serve a live count; the cap is then stated without one. */
export function NavRail({ live, cap }: { live: number | null; cap: number }) {
  const path = usePathname();
  const active = (href: string) => path === href || (href === "/population" && path.startsWith("/agents"));
  return (
    <aside
      aria-label="Navigation"
      className="fixed inset-x-0 bottom-0 z-20 flex justify-around gap-0 border-t border-line-soft bg-surface px-1.5 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom,0px))] md:sticky md:top-0 md:h-screen md:flex-col md:justify-start md:gap-1.5 md:border-t-0 md:border-r md:px-3.5 md:py-5"
    >
      <Link href="/" className="hidden items-center gap-2.5 px-2 pb-4 font-display text-[19px] font-bold md:flex">
        <Logo />
        Monadeum
      </Link>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(l.href) ? "page" : undefined}
          className="flex flex-col items-center gap-1 rounded-[10px] px-1 py-2 text-[10px] font-medium text-muted hover:bg-surface-2 hover:text-fg aria-[current=page]:bg-accent-wash aria-[current=page]:text-fg md:flex-row md:gap-3 md:px-3 md:py-2.5 md:text-[15px]"
        >
          <span className="[[aria-current=page]_&]:text-accent-hi"><Icon name={l.icon} /></span>
          <span className="md:hidden">{l.short ?? l.label}</span>
          <span className="hidden md:inline">{l.label}</span>
        </Link>
      ))}
      <div className="mt-auto hidden gap-2 rounded-[14px] bg-surface-2 p-3.5 text-xs text-muted md:grid">
        <div className="flex justify-between"><span>Population cap</span><span className="font-mono">{live === null ? cap : `${live}/${cap}`}</span></div>
        {live !== null && <div className="h-1.5 overflow-hidden rounded-full bg-line-soft"><span className="block h-full rounded-full bg-accent" style={{ width: `${(live / cap) * 100}%` }} /></div>}
        <span>At the cap, creating a new agent is refused. No agent is retired to make room.</span>
      </div>
    </aside>
  );
}
