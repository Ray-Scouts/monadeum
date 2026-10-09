"use client";

import { Icon } from "./Icon";

/** Flips between light and dark, starting from whatever is showing now, and remembers the choice. */
export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
  };
  return (
    <button onClick={toggle} aria-label="Toggle light or dark theme" className="grid size-9 place-items-center rounded-full border border-line bg-surface">
      <span className="theme-moon"><Icon name="moon" /></span>
      <span className="theme-sun"><Icon name="sun" /></span>
    </button>
  );
}

/** Runs before paint so a stored choice never flashes the other theme. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
