"use client";

import { useEffect, useRef } from "react";
import { onThemeChange } from "./hooks";

const NICHE_VARS = ["--sky", "--mint", "--accent", "--berry", "--sun"] as const;

interface Cell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fit: number;
  niche: number;
  r: number;
  age: number;
  dead: boolean;
  split: number;
}

interface Link {
  a: Cell;
  b: Cell;
  life: number;
}

interface PetriProps {
  /** Starting number of cells. */
  n: number;
  /** Round dish (hero) or rectangular field (closing band). */
  round: boolean;
  /** CSS variable used for parent-to-child links. Defaults to --fg. */
  lineColor?: string;
  className?: string;
}

/**
 * Decorative population animation. Cells are colored by risk niche, the fittest split with a
 * flash and a link to their child, the weakest retire as hollow rings, and the pointer pushes
 * cells away. Randomness is seeded inside the effect, so server and client markup match.
 */
export function Petri({ n, round, lineColor = "--fg", className = "" }: PetriProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0;
    let H = 0;
    let cells: Cell[] = [];
    let links: Link[] = [];
    let mouse: { x: number; y: number } | null = null;
    let raf = 0;
    let visible = false;
    let colors = { niches: [] as string[], faint: "", sun: "", line: "" };

    const readColors = () => {
      const cs = getComputedStyle(document.documentElement);
      const v = (name: string) => cs.getPropertyValue(name).trim();
      colors = { niches: NICHE_VARS.map(v), faint: v("--faint"), sun: v("--sun"), line: v(lineColor) };
    };

    const inside = (x: number, y: number) =>
      round ? Math.hypot(x - W / 2, y - H / 2) < W / 2 - 16 : x > 8 && y > 8 && x < W - 8 && y < H - 8;

    const spawn = (x: number, y: number, fit?: number, niche?: number) => {
      const c: Cell = {
        x,
        y,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        fit: fit ?? Math.random(),
        niche: niche ?? Math.floor(Math.random() * 5),
        r: 2.5 + Math.random() * 2.5,
        age: Math.random() * 200,
        dead: false,
        split: 0,
      };
      cells.push(c);
      return c;
    };

    const size = () => {
      const rect = cv.getBoundingClientRect();
      const d = window.devicePixelRatio || 1;
      const ow = W;
      const oh = H;
      W = rect.width;
      H = rect.height;
      cv.width = Math.max(1, Math.round(W * d));
      cv.height = Math.max(1, Math.round(H * d));
      ctx.setTransform(d, 0, 0, d, 0, 0);
      if (ow && oh && W && H) cells.forEach((c) => { c.x *= W / ow; c.y *= H / oh; });
    };

    const init = () => {
      size();
      cells = [];
      for (let i = 0; i < n; i++) {
        let x = 0;
        let y = 0;
        let tries = 0;
        do { x = Math.random() * W; y = Math.random() * H; } while (!inside(x, y) && tries++ < 50);
        spawn(x, y);
      }
      // Reduced motion shows one static frame: retire a few cells so the legend matches what is drawn.
      if (reduce) cells.forEach((c, i) => { if (i % 9 === 4) c.dead = true; });
    };

    const update = () => {
      links = links.filter((l) => (l.life -= 0.01) > 0);
      const alive = cells.filter((c) => !c.dead).length;
      for (const c of [...cells]) {
        if (!c.dead) {
          if (mouse) {
            const dx = c.x - mouse.x;
            const dy = c.y - mouse.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 70 && dist > 0) { c.vx += (dx / dist) * 0.08; c.vy += (dy / dist) * 0.08; }
          }
          c.vx *= 0.992;
          c.vy *= 0.992;
          if (Math.hypot(c.vx, c.vy) < 0.15) { c.vx += (Math.random() - 0.5) * 0.05; c.vy += (Math.random() - 0.5) * 0.05; }
          c.x += c.vx;
          c.y += c.vy;
          if (!inside(c.x, c.y)) { c.vx *= -1; c.vy *= -1; c.x += c.vx * 3; c.y += c.vy * 3; }
          c.age++;
          c.fit = Math.min(1, Math.max(0, c.fit + (Math.random() - 0.5) * 0.012));
          if (c.fit > 0.8 && c.age > 260 && alive < n * 1.5 && Math.random() < 0.006) {
            c.split = 1;
            c.age = 0;
            const child = spawn(
              c.x + (Math.random() - 0.5) * 8,
              c.y + (Math.random() - 0.5) * 8,
              c.fit * 0.85,
              Math.random() < 0.85 ? c.niche : Math.floor(Math.random() * 5),
            );
            links.push({ a: c, b: child, life: 1 });
          }
          if (c.fit < 0.12 && c.age > 300 && Math.random() < 0.004) c.dead = true;
        }
        c.split = Math.max(0, c.split - 0.015);
      }
      const di = cells.findIndex((c) => c.dead);
      if (cells.length > n * 2 && di > -1) cells.splice(di, 1);
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const l of links) {
        ctx.strokeStyle = colors.line;
        ctx.globalAlpha = l.life * 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(l.a.x, l.a.y);
        ctx.lineTo(l.b.x, l.b.y);
        ctx.stroke();
      }
      for (const c of cells) {
        const r = c.r + c.fit * 3 + c.split * 5;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        if (c.dead) {
          ctx.strokeStyle = colors.faint;
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        } else {
          ctx.fillStyle = colors.niches[c.niche] ?? colors.line;
          ctx.globalAlpha = 0.5 + c.fit * 0.5;
          ctx.fill();
          if (c.split > 0) {
            ctx.beginPath();
            ctx.arc(c.x, c.y, r + 12 * (1 - c.split), 0, Math.PI * 2);
            ctx.strokeStyle = colors.sun;
            ctx.globalAlpha = c.split * 0.8;
            ctx.lineWidth = 1.6;
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }
    };

    const loop = () => {
      update();
      draw();
      raf = visible ? requestAnimationFrame(loop) : 0;
    };
    const start = () => { if (!reduce && visible && !raf) raf = requestAnimationFrame(loop); };

    readColors();
    init();
    draw();

    const ro = new ResizeObserver(() => { if (!W || !H) init(); else size(); draw(); });
    ro.observe(cv);
    const io = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) start();
    });
    io.observe(cv);
    const stopTheme = onThemeChange(() => { readColors(); draw(); });

    const onMove = (e: PointerEvent) => {
      const rect = cv.getBoundingClientRect();
      mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onLeave = () => { mouse = null; };
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      stopTheme();
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerleave", onLeave);
    };
  }, [n, round, lineColor]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
