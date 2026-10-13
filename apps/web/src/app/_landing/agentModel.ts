// Pure model of the hero illustration: who the sample agents are, what each one looks like, where each one is at a
// given time, and which scene the loop is in. Nothing here reads the DOM or the network, so server render, client
// render and the tests all agree. Every agent is a sample: none of these names is a real account.

/** Side length of the square the hero SVG is drawn in. */
export const VIEW = 640;
export const CENTER = VIEW / 2;

/** FNV-1a over UTF-16 code units, then a finalizer mix, so close names give unrelated marks. */
export function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export type EyeKind = "dot" | "pill" | "happy" | "visor";
export type MouthKind = "none" | "flat" | "smile" | "round";
export type CrestKind = "none" | "antenna" | "ears" | "horns";
export type CheekKind = "none" | "dots" | "stripes";

export interface GlyphSpec {
  eyes: EyeKind;
  /** Half the distance between the eyes, in glyph units where the body is 2 wide. */
  eyeGap: number;
  mouth: MouthKind;
  crest: CrestKind;
  cheeks: CheekKind;
  /** 0 to 3: which corner carries the small badge, or -1 for none. */
  badge: number;
}

const EYES: readonly EyeKind[] = ["dot", "pill", "happy", "visor"];
const MOUTHS: readonly MouthKind[] = ["none", "flat", "smile", "round"];
const CRESTS: readonly CrestKind[] = ["none", "antenna", "ears", "horns"];
const CHEEKS: readonly CheekKind[] = ["none", "dots", "stripes"];

/** The mark of an agent, derived only from its name. The same name always gives the same mark. */
export function glyphSpec(name: string): GlyphSpec {
  const h = hashName(name);
  const badge = (h >>> 12) & 7;
  return {
    eyes: EYES[h & 3] as EyeKind,
    eyeGap: (h >>> 2) & 1 ? 0.34 : 0.42,
    mouth: MOUTHS[(h >>> 3) & 3] as MouthKind,
    crest: CRESTS[(h >>> 5) & 3] as CrestKind,
    cheeks: CHEEKS[((h >>> 7) & 7) % 3] as CheekKind,
    badge: badge < 4 ? badge : -1,
  };
}

export type Status = "active" | "retiring";

export interface SampleAgent {
  id: string;
  name: string;
  /** Index into the five niche hues. */
  niche: 0 | 1 | 2 | 3 | 4;
  owner: "a" | "b" | "c";
  status: Status;
  /** Orbit radius, angle at time zero (radians), angular speed (radians per second), body half size. */
  orbit: number;
  angle: number;
  speed: number;
  size: number;
  /** Phase offset of the small radial drift. */
  drift: number;
}

export const NICHE_VARS = ["--sky", "--mint", "--accent", "--berry", "--sun"] as const;

// Owner "a" is the one that moves capital in the reallocation scene (Nimbus to Kestrel). Owner "b" holds the agent whose
// action the policy rejects (Orca). The tags carry the short hash suffix the rest of the page uses.
export const AGENTS: readonly SampleAgent[] = [
  { id: "nimbus", name: "Nimbus·3c1d", niche: 3, owner: "a", status: "active", orbit: 258, angle: 3.7, speed: 0.028, size: 29, drift: 0.4 },
  { id: "kestrel", name: "Kestrel·a1f0", niche: 1, owner: "a", status: "active", orbit: 182, angle: 5.1, speed: -0.04, size: 31, drift: 1.9 },
  { id: "ferro", name: "Ferro·c1a9", niche: 4, owner: "a", status: "retiring", orbit: 258, angle: 0.5, speed: 0.028, size: 24, drift: 3.1 },
  { id: "orca", name: "Orca·19bd", niche: 0, owner: "b", status: "active", orbit: 258, angle: 2.15, speed: 0.028, size: 30, drift: 5.2 },
  { id: "vela", name: "Vela·4e02", niche: 2, owner: "b", status: "active", orbit: 182, angle: 1.6, speed: -0.04, size: 28, drift: 2.4 },
  { id: "quill", name: "Quill·0b7e", niche: 0, owner: "b", status: "active", orbit: 100, angle: 4.4, speed: 0.058, size: 24, drift: 4.6 },
  { id: "lumen", name: "Lumen·77c2", niche: 1, owner: "c", status: "active", orbit: 258, angle: 5.6, speed: 0.028, size: 26, drift: 0.9 },
  { id: "sable", name: "Sable·e5d3", niche: 3, owner: "c", status: "retiring", orbit: 182, angle: 3.4, speed: -0.04, size: 25, drift: 3.8 },
  { id: "pike", name: "Pike·8a60", niche: 4, owner: "c", status: "active", orbit: 100, angle: 0.9, speed: 0.058, size: 25, drift: 5.9 },
  { id: "wren", name: "Wren·2f94", niche: 2, owner: "b", status: "active", orbit: 258, angle: 1.05, speed: 0.028, size: 24, drift: 1.2 },
  { id: "heron", name: "Heron·b3a7", niche: 0, owner: "c", status: "active", orbit: 182, angle: 0.2, speed: -0.04, size: 26, drift: 2.9 },
  { id: "tarn", name: "Tarn·d610", niche: 4, owner: "a", status: "active", orbit: 258, angle: 4.9, speed: 0.028, size: 23, drift: 4.1 },
];

export const agentById = (id: string): SampleAgent => AGENTS.find((a) => a.id === id) ?? (AGENTS[0] as SampleAgent);

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Where an agent is `t` seconds into the loop. Slow orbit plus a small radial drift, always inside the circle. */
export function positionAt(a: SampleAgent, t: number): { x: number; y: number } {
  const ang = a.angle + a.speed * t;
  const rad = a.orbit + Math.sin(t * 0.21 + a.drift) * 7;
  return { x: r2(CENTER + Math.cos(ang) * rad), y: r2(CENTER + Math.sin(ang) * rad) };
}

/** Same-owner pairs drawn as faint tethers: the set of agents that one owner holds. */
export const TETHERS: readonly (readonly [string, string])[] = [
  ["nimbus", "kestrel"],
  ["kestrel", "tarn"],
  ["orca", "vela"],
  ["vela", "wren"],
  ["lumen", "pike"],
  ["pike", "heron"],
];

/** The static frame used for reduced motion: where agents stand and how far the loop has progressed. */
export const STATIC_TIME = 24;

/** Quadratic arc between two points, bent toward the center so arcs read as curves, not chords. */
export function arc(p: { x: number; y: number }, q: { x: number; y: number }): { d: string; cx: number; cy: number } {
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  const cx = r2(mx + (CENTER - mx) * 0.45);
  const cy = r2(my + (CENTER - my) * 0.45);
  return { d: `M${p.x} ${p.y}Q${cx} ${cy} ${q.x} ${q.y}`, cx, cy };
}

/** Point at fraction `u` along the quadratic arc from p to q with control (cx, cy). */
export function arcPoint(p: { x: number; y: number }, q: { x: number; y: number }, cx: number, cy: number, u: number): { x: number; y: number } {
  const m = 1 - u;
  return { x: m * m * p.x + 2 * m * u * cx + u * u * q.x, y: m * m * p.y + 2 * m * u * cy + u * u * q.y };
}

/** One full pass of the scenes, in seconds. */
export const LOOP = 17;

export type Phase = "idle" | "move" | "check" | "reject" | "settle";

/**
 * Timeline of one loop. The capital move runs 0.8 to 7, the policy check opens at 7.4 and is rejected at 9.4, and the
 * cards fade by 15. Everything the renderer animates is a function of this one clock.
 */
export function phaseAt(t: number): Phase {
  const u = ((t % LOOP) + LOOP) % LOOP;
  if (u < 0.8) return "idle";
  if (u < 7.2) return "move";
  if (u < 9.4) return "check";
  if (u < 14.6) return "reject";
  return "settle";
}

/** Clamp to 0..1 after mapping the span [a, b]. */
export const span = (u: number, a: number, b: number) => Math.min(1, Math.max(0, (u - a) / (b - a)));

/** Cubic ease in and out. */
export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export interface Scene {
  phase: Phase | "static";
  /** Draw progress of the capital arc, and its opacity. */
  arcP: number;
  arcAlpha: number;
  /** Position of the traveling mark along the arc, or -1 when it is not shown. */
  particle: number;
  /** 0..1 progress of the receiving agent's pulse, or -1. */
  receive: number;
  /** 0..1 progress of the policy check ripple, or -1. */
  ripple: number;
  /** 0..1 progress of the rejection flash, or -1. */
  flash: number;
  /** 0..1 how strongly the rejected agent is held in the red state. */
  hold: number;
  /** Which agents carry a name tag in this scene, with the role word. */
  tags: readonly { id: string; role: string }[];
}

export const SENDER = "nimbus";
export const RECEIVER = "kestrel";
export const REJECTED = "orca";

/** Everything the renderer needs at loop time `u` (seconds). `null` is the static composed frame. */
export function sceneAt(u: number | null): Scene {
  if (u === null) {
    return {
      phase: "static",
      arcP: 1,
      arcAlpha: 0.85,
      particle: -1,
      receive: -1,
      ripple: -1,
      flash: -1,
      hold: 1,
      tags: [
        { id: SENDER, role: "sends" },
        { id: RECEIVER, role: "receives" },
        { id: REJECTED, role: "rejected" },
      ],
    };
  }
  const t = ((u % LOOP) + LOOP) % LOOP;
  const move = t >= 0.8 && t < 7.4;
  const verdict = t >= 7.4 && t < 14.6;
  const pp = span(t, 1.4, 3.4);
  const rp = span(t, 3.4, 4.8);
  const cp = span(t, 7.4, 9.2);
  const fp = span(t, 9.4, 10.4);
  return {
    phase: phaseAt(t),
    arcP: ease(span(t, 0.8, 2.6)),
    arcAlpha: t < 0.8 ? 0 : 1 - span(t, 5.6, 7),
    particle: pp > 0 && pp < 1 ? ease(pp) : -1,
    receive: rp > 0 && rp < 1 ? rp : -1,
    ripple: cp > 0 && cp < 1 ? cp : -1,
    flash: fp > 0 && fp < 1 ? fp : -1,
    hold: span(t, 9.4, 9.8) * (1 - span(t, 13.4, 14.6)),
    tags: move
      ? [
          { id: SENDER, role: "sends" },
          { id: RECEIVER, role: "receives" },
        ]
      : verdict
        ? [{ id: REJECTED, role: t < 9.4 ? "checking" : "rejected" }]
        : [],
  };
}
