"use client";

import { useEffect, useRef, useState } from "react";
import { GlyphArt, GlyphIcon } from "./AgentGlyph";
import {
  AGENTS,
  CENTER,
  NICHE_VARS,
  RECEIVER,
  REJECTED,
  SENDER,
  STATIC_TIME,
  TETHERS,
  VIEW,
  agentById,
  arc,
  arcPoint,
  positionAt,
  sceneAt,
  type Scene,
} from "./agentModel";
import { useReducedMotion } from "./hooks";
import { money, REALLOC } from "./numbers";
import s from "./landing.module.css";

const ORBITS = [100, 182, 258] as const;
const LOGO = "M16 2c-3.9 0-14 10.1-14 14s10.1 14 14 14 14-10.1 14-14S19.9 2 16 2zm-2.2 22c-1.6-.4-6-8.2-5.6-9.8.4-1.6 8.2-6 9.8-5.6 1.6.4 6 8.2 5.6 9.8-.4 1.6-8.2 6-9.8 5.6z";

type CardPhase = Scene["phase"];

/**
 * The hero illustration: a sample population of agents, each with a mark derived from its name, drifting on slow orbits.
 * A loop shows two scenes, a capped move of capital between two agents of one owner, then a policy check that rejects a
 * proposal. All of it is a sample: reallocation is off by default and nothing here is read from a running deployment.
 * One rAF loop writes transforms straight to the DOM (no React work per frame); it stops off screen, in a hidden tab,
 * and under reduced motion, which gets a single composed frame.
 */
export function AgentField() {
  const reduce = useReducedMotion();
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const tagsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const [phase, setPhase] = useState<CardPhase>("idle");

  useEffect(() => {
    const root = svg.current;
    const box = wrap.current;
    if (!root || !box) return;
    const q = <T extends Element>(sel: string) => root.querySelector<T>(sel);
    const nodes = AGENTS.map((a) => ({
      a,
      g: q<SVGGElement>(`[data-agent="${a.id}"]`),
      body: q<SVGGElement>(`[data-body="${a.id}"]`),
      ring: q<SVGCircleElement>(`[data-ring="${a.id}"]`),
    }));
    const tethers = TETHERS.map(([x, y]) => ({ x, y, el: q<SVGPathElement>(`[data-tether="${x}-${y}"]`) }));
    const arcLine = q<SVGPathElement>("[data-arc]");
    const arcGlow = q<SVGPathElement>("[data-arc-glow]");
    const mark = q<SVGGElement>("[data-mark]");
    const recvRing = q<SVGCircleElement>("[data-recv]");
    const checkRing = q<SVGCircleElement>("[data-check]");
    const rejRing = q<SVGCircleElement>("[data-rejring]");
    const rejX = q<SVGGElement>("[data-rejx]");
    const tagEls = tagsRef.current;
    const pos = new Map<string, { x: number; y: number }>();
    let hover: string | null = null;
    let current: Scene = sceneAt(null);
    let lastPhase: CardPhase | null = null;
    let tNow = reduce ? STATIC_TIME : 0;

    const setTag = (slot: number, id: string | null, role: string, scale: number) => {
      const el = tagEls[slot];
      if (!el) return;
      const p = id ? pos.get(id) : undefined;
      if (!id || !p) {
        el.dataset.on = "false";
        return;
      }
      const ag = agentById(id);
      const label = el.querySelector("b");
      const next = `${ag.name}${role ? ` · ${role}` : ""}`;
      if (label && label.textContent !== next) label.textContent = next;
      el.dataset.retiring = ag.status === "retiring" ? "true" : "false";
      el.style.setProperty("--tag", role === "rejected" ? "var(--bad)" : `var(${NICHE_VARS[ag.niche]})`);
      el.style.transform = `translate(${(p.x * scale).toFixed(1)}px, ${((p.y + ag.size * 1.35) * scale).toFixed(1)}px) translate(-50%, 0)`;
      el.dataset.on = "true";
    };

    const render = (t: number, sc: Scene) => {
      current = sc;
      const scale = box.clientWidth / VIEW || 1;
      for (const n of nodes) {
        const p = positionAt(n.a, t);
        pos.set(n.a.id, p);
        let k = 1;
        let dx = 0;
        if (n.a.id === RECEIVER && sc.receive >= 0) k = 1 + 0.16 * Math.sin(Math.PI * sc.receive);
        if (n.a.id === REJECTED && sc.flash >= 0) {
          dx = Math.sin(sc.flash * 26) * 5 * (1 - sc.flash);
          k = 1 + 0.1 * (1 - sc.flash);
        }
        n.g?.setAttribute("transform", `translate(${(p.x + dx).toFixed(2)} ${p.y.toFixed(2)})`);
        n.body?.setAttribute("transform", `scale(${(n.a.size * k).toFixed(3)})`);
      }
      for (const th of tethers) {
        const p = pos.get(th.x);
        const r = pos.get(th.y);
        if (p && r) th.el?.setAttribute("d", arc(p, r).d);
      }
      const from = pos.get(SENDER);
      const to = pos.get(RECEIVER);
      if (from && to && sc.arcAlpha > 0) {
        const c = arc(from, to);
        arcLine?.setAttribute("d", c.d);
        arcGlow?.setAttribute("d", c.d);
        for (const el of [arcLine, arcGlow]) {
          if (!el) continue;
          el.style.strokeDashoffset = String(1 - sc.arcP);
          el.style.opacity = String(sc.arcAlpha);
        }
        if (mark) {
          if (sc.particle >= 0) {
            const m = arcPoint(from, to, c.cx, c.cy, sc.particle);
            mark.setAttribute("transform", `translate(${m.x.toFixed(2)} ${m.y.toFixed(2)})`);
            mark.style.opacity = "1";
          } else mark.style.opacity = "0";
        }
      } else {
        if (arcLine) arcLine.style.opacity = "0";
        if (arcGlow) arcGlow.style.opacity = "0";
        if (mark) mark.style.opacity = "0";
      }
      const ring = (el: SVGCircleElement | null, at: { x: number; y: number } | undefined, u: number, r0: number, r1: number, a: number) => {
        if (!el) return;
        if (!at || u < 0) {
          el.style.opacity = "0";
          return;
        }
        el.setAttribute("cx", at.x.toFixed(2));
        el.setAttribute("cy", at.y.toFixed(2));
        el.setAttribute("r", (r0 + (r1 - r0) * (1 - Math.pow(1 - u, 2))).toFixed(1));
        el.style.opacity = String(a * (1 - u));
      };
      ring(recvRing, to, sc.receive, 34, 92, 0.75);
      const orca = pos.get(REJECTED);
      ring(checkRing, orca, sc.ripple, 34, 170, 0.5);
      ring(rejRing, orca, sc.flash, 32, 84, 0.9);
      const hold = sc.hold;
      const rn = nodes.find((n) => n.a.id === REJECTED);
      if (rn?.ring) {
        rn.ring.style.stroke = hold > 0.01 ? "var(--bad)" : "";
        rn.ring.style.opacity = hold > 0.01 ? String(0.55 + 0.45 * hold) : "";
      }
      if (rejX && orca) {
        rejX.style.opacity = String(hold);
        rejX.setAttribute("transform", `translate(${(orca.x + 22).toFixed(1)} ${(orca.y - 24).toFixed(1)})`);
      }
      setTag(0, sc.tags[0]?.id ?? null, sc.tags[0]?.role ?? "", scale);
      setTag(1, sc.tags[1]?.id ?? null, sc.tags[1]?.role ?? "", scale);
      setTag(2, sc.tags[2]?.id ?? null, sc.tags[2]?.role ?? "", scale);
      const hv = hover && !sc.tags.some((tg) => tg.id === hover) ? hover : null;
      setTag(3, hv, hv ? (agentById(hv).status === "retiring" ? "retiring" : "active") : "", scale);
      if (sc.phase !== lastPhase) {
        lastPhase = sc.phase;
        setPhase(sc.phase);
      }
    };

    if (reduce) {
      render(STATIC_TIME, sceneAt(null));
      const ro = new ResizeObserver(() => render(STATIC_TIME, sceneAt(null)));
      ro.observe(box);
      const move = (e: PointerEvent) => {
        hover = nearest(e);
        render(STATIC_TIME, sceneAt(null));
      };
      root.addEventListener("pointermove", move);
      root.addEventListener("pointerleave", () => { hover = null; render(STATIC_TIME, sceneAt(null)); });
      return () => { ro.disconnect(); root.removeEventListener("pointermove", move); };
    }

    function nearest(e: PointerEvent): string | null {
      const rect = root!.getBoundingClientRect();
      const k = VIEW / rect.width;
      const x = (e.clientX - rect.left) * k;
      const y = (e.clientY - rect.top) * k;
      let best: string | null = null;
      let bd = 54;
      for (const [id, p] of pos) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = id; }
      }
      return best;
    }

    let raf = 0;
    let last = 0;
    let onScreen = false;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tNow += dt;
      render(tNow, sceneAt(tNow));
      raf = onScreen && !document.hidden ? requestAnimationFrame(frame) : 0;
    };
    const kick = () => {
      if (raf || !onScreen || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    render(0, sceneAt(0));
    const io = new IntersectionObserver(([en]) => { onScreen = Boolean(en?.isIntersecting); kick(); });
    io.observe(box);
    const vis = () => kick();
    document.addEventListener("visibilitychange", vis);
    const ro = new ResizeObserver(() => render(tNow, current.phase === "static" ? sceneAt(null) : sceneAt(tNow)));
    ro.observe(box);
    const move = (e: PointerEvent) => { hover = nearest(e); };
    const leave = () => { hover = null; };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerdown", move);
    root.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", vis);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerdown", move);
      root.removeEventListener("pointerleave", leave);
    };
  }, [reduce]);

  const moveOn = phase === "move" || phase === "static";
  const policyOn = phase === "check" || phase === "reject" || phase === "static";
  const rejected = phase === "reject" || phase === "static";
  const sender = agentById(SENDER);
  const receiver = agentById(RECEIVER);
  const rej = agentById(REJECTED);

  return (
    <div className={s.stage}>
      <div className={s.petri} ref={wrap}>
        <svg
          ref={svg}
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className={s.field}
          role="img"
          aria-label="Sample illustration: a population of AI agents, each with its own mark, drifting in orbit. Capital moves along an arc between two agents of one owner, then a policy check rejects a proposal. Not live data."
        >
          <defs>
            {NICHE_VARS.map((v, i) => (
              <linearGradient key={`b${v}`} id={`af-body-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: `var(${v})` }} />
                <stop offset="1" style={{ stopColor: `color-mix(in srgb, var(${v}) 64%, var(--bg))` }} />
              </linearGradient>
            ))}
            {NICHE_VARS.map((v, i) => (
              <radialGradient key={`h${v}`} id={`af-halo-${i}`}>
                <stop offset="0.4" style={{ stopColor: `var(${v})`, stopOpacity: 0.22 }} />
                <stop offset="1" style={{ stopColor: `var(${v})`, stopOpacity: 0 }} />
              </radialGradient>
            ))}
            <radialGradient id="af-core">
              <stop offset="0" style={{ stopColor: "var(--accent)", stopOpacity: 0.34 }} />
              <stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
            </radialGradient>
            <linearGradient id="af-sweep" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style={{ stopColor: "var(--accent-hi)", stopOpacity: 0 }} />
              <stop offset="1" style={{ stopColor: "var(--accent-hi)", stopOpacity: 0.6 }} />
            </linearGradient>
          </defs>

          <circle cx={CENTER} cy={CENTER} r={170} fill="url(#af-core)" />
          <g className={s.sweep}>
            <circle cx={CENTER} cy={CENTER} r={ORBITS[2] + 36} fill="none" stroke="url(#af-sweep)" strokeWidth={2} strokeLinecap="round" strokeDasharray="260 1360" />
          </g>
          {ORBITS.map((r, i) => (
            <circle key={r} cx={CENTER} cy={CENTER} r={r} fill="none" style={{ stroke: "var(--line)", opacity: 0.85 - i * 0.2 }} strokeWidth={1} strokeDasharray={i === 1 ? "2 7" : "1 5"} strokeLinecap="round" />
          ))}
          <g transform={`translate(${CENTER - 22} ${CENTER - 22}) scale(${44 / 32})`} className={s.core} style={{ fill: "var(--accent)" }}>
            <path d={LOGO} />
          </g>

          {TETHERS.map(([a, b]) => (
            <path key={`${a}-${b}`} data-tether={`${a}-${b}`} className={s.tether} fill="none" />
          ))}

          <path data-arc-glow pathLength={1} className={s.arcGlow} fill="none" />
          <path data-arc pathLength={1} className={s.arc} fill="none" />

          <circle data-recv fill="none" className={s.rippleOk} />
          <circle data-check fill="none" className={s.rippleCheck} />
          <circle data-rejring fill="none" className={s.rippleBad} />

          {AGENTS.map((a) => {
            const p = positionAt(a, 0);
            return (
              <g key={a.id} data-agent={a.id} transform={`translate(${p.x} ${p.y})`} className={a.status === "retiring" ? s.retiring : undefined}>
                <circle r={a.size * 2.1} style={{ fill: `url(#af-halo-${a.niche})` }} />
                <circle data-ring={a.id} r={a.size * 1.3} fill="none" className={a.status === "retiring" ? s.ringRetiring : s.ringActive} style={a.status === "retiring" ? undefined : { stroke: `var(${NICHE_VARS[a.niche]})` }} />
                <g data-body={a.id} transform={`scale(${a.size})`}>
                  <GlyphArt name={a.name} niche={a.niche} gradient />
                </g>
              </g>
            );
          })}

          <g data-rejx style={{ opacity: 0 }} className={s.rejX}>
            <circle r={11} />
            <path d="M-4 -4L4 4M4 -4L-4 4" />
          </g>
          <g data-mark style={{ opacity: 0 }}>
            <circle r={13} className={s.markGlow} />
            <circle r={5.5} className={s.markDot} />
          </g>
        </svg>

        <div className={s.tags} aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={s.tag} data-on="false" ref={(el) => { tagsRef.current[i] = el; }}>
              <i />
              <b />
            </span>
          ))}
        </div>
      </div>

      <div className={s.cards} data-static={phase === "static"}>
        <div className={`${s.floatCard} ${s.fc1}`} data-on={moveOn} aria-hidden="true">
          <span className="eyebrow">Reallocation · sample</span>
          <div className={s.cardRow}>
            <GlyphIcon name={sender.name} niche={sender.niche} />
            <span className={s.cardArrow}>→</span>
            <GlyphIcon name={receiver.name} niche={receiver.niche} />
            <b>{sender.name} → {receiver.name}</b>
          </div>
          <span className="text-muted">{money(REALLOC.moved)} between agents of one owner. Their total is unchanged.</span>
        </div>
        <div className={`${s.floatCard} ${s.fc2}`} data-on={policyOn} data-bad={rejected} aria-hidden="true">
          <span className="eyebrow">Policy · sample</span>
          <div className={s.cardRow}>
            <GlyphIcon name={rej.name} niche={rej.niche} />
            {rejected ? (
              <b><span className={s.dotc} style={{ background: "var(--bad)" }} />Rejected</b>
            ) : (
              <b><span className={`${s.dotc} ${s.checking}`} style={{ background: "var(--accent-hi)" }} />Checking {rej.name}</b>
            )}
          </div>
          <span className="text-muted">{rejected ? "Exceeds per-transaction cap" : "Against its caps and allowed contracts"}</span>
        </div>
      </div>

      <div className={s.petriLegend}>
        <span><i className={s.lgActive} />Active</span>
        <span><i className={s.lgRetiring} />Retiring</span>
        <span><i className={s.lgArc} />Capital moving between one owner&apos;s agents</span>
      </div>
      <p className={s.sampleNote}>Sample illustration, not live data. The agents are made up and each mark is derived from its name. Color is the risk niche. Reallocation is off by default.</p>
    </div>
  );
}
