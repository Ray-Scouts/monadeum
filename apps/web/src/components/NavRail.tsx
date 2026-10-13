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
      className="fixed inset-x-0 bottom-0 z-20 flex justify-around gap-0 border-t border-line-soft bg-surface px-1.5 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom,0px))] lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:justify-start lg:gap-1.5 lg:border-t-0 lg:border-r lg:px-3.5 lg:py-5"
    >
      <Link href="/" className="hidden items-center gap-2.5 px-2 pb-4 font-display text-[19px] font-bold lg:flex">
        <Logo />
        Monadeum
      </Link>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(l.href) ? "page" : undefined}
          className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[10px] px-1 py-2 text-xs lg:flex-none font-medium text-muted hover:bg-surface-2 hover:text-fg aria-[current=page]:bg-accent-wash aria-[current=page]:text-fg lg:flex-row lg:gap-3 lg:px-3 lg:py-3 lg:text-[15px]"
        >
          <span className="[[aria-current=page]_&]:text-accent-hi"><Icon name={l.icon} /></span>
          <span className="lg:hidden">{l.short ?? l.label}</span>
          <span className="hidden lg:inline">{l.label}</span>
        </Link>
      ))}
      <div className="mt-auto hidden gap-2 rounded-[14px] bg-surface-2 p-3.5 text-xs text-muted lg:grid">
        <div className="flex justify-between"><span>Population cap</span><span className="font-mono">{live === null ? cap : `${live}/${cap}`}</span></div>
        {live !== null && <div className="h-1.5 overflow-hidden rounded-full bg-line-soft"><span className="block h-full rounded-full bg-accent" style={{ width: `${(live / cap) * 100}%` }} /></div>}
        <span>At the cap, creating a new agent is refused. No agent is retired to make room.</span>
      </div>
    </aside>
  );
}
