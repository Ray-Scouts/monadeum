import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Kpi, Pill, Sparkline } from "./ui";
import { Segmented } from "./Segmented";
import { ThemeToggle } from "./ThemeToggle";

// The responsive rules of apps/web/README.md, asserted on the shared tokens and components.

const css = readFileSync(join(import.meta.dir, "../app/globals.css"), "utf8");
const noop = () => undefined;

describe("responsive tokens", () => {
  test("form fields are 16px and at least 44px tall, so iOS does not zoom on focus", () => {
    expect(css).toMatch(/select, textarea \{ font-size: 16px; min-height: 44px; \}/);
  });

  test("buttons have a 44px minimum height", () => {
    expect(css).toMatch(/@utility btn \{[^}]*min-height: 44px/);
  });

  test("the long-value and touch-target utilities exist", () => {
    expect(css).toMatch(/@utility long-value \{ overflow-wrap: anywhere/);
    expect(css).toMatch(/@utility tap \{ min-height: 44px; min-width: 44px; \}/);
  });

  test("the eyebrow label has a line height that lets it wrap without overlap", () => {
    expect(css).toMatch(/@utility eyebrow \{ font: 500 12px\/1\.35/);
  });

  test("range sliders, checkboxes and radios have a usable size", () => {
    expect(css).toMatch(/input\[type="range"\] \{ min-height: 44px/);
    expect(css).toMatch(/width: 20px; height: 20px/);
  });
});

describe("responsive components", () => {
  test("a KPI value wraps long amounts instead of widening the page", () => {
    const html = renderToStaticMarkup(<Kpi label="Total capital" value="987654321.987654 USDC" />);
    expect(html).toContain("long-value");
  });

  test("a pill may wrap and never exceeds its container", () => {
    const html = renderToStaticMarkup(<Pill tone="warn">Stopping: key destroyed, on-chain revocation pending</Pill>);
    expect(html).toContain("max-w-full");
    expect(html).not.toContain("whitespace-nowrap");
  });

  test("segmented options are 44px tall", () => {
    const html = renderToStaticMarkup(<Segmented label="Filter" value="a" onChange={noop} options={[{ value: "a", label: "A" }]} />);
    expect(html).toContain("tap-y");
  });

  test("navigation items share the bar equally and the rail starts at lg", () => {
    const src = readFileSync(join(import.meta.dir, "NavRail.tsx"), "utf8");
    expect(src).toContain("min-w-0 flex-1");
    expect(src).toContain("lg:sticky");
    expect(src).not.toContain("md:");
  });

  test("the theme toggle is 44px", () => {
    expect(renderToStaticMarkup(<ThemeToggle />)).toContain("size-11");
  });

  test("a sparkline scales down inside a narrow card", () => {
    expect(renderToStaticMarkup(<Sparkline values={[1, 2, 3]} width={300} />)).toContain("max-w-full");
  });
});
