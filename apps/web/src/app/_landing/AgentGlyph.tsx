import { NICHE_VARS, glyphSpec } from "./agentModel";

const INK = { fill: "var(--bg)" } as const;
const STROKE = { stroke: "var(--bg)", fill: "none", strokeLinecap: "round" } as const;

/**
 * The body and face of one sample agent in unit space: the body spans -1 to 1 on both axes. The mark is derived from the
 * name alone (`glyphSpec`), so an agent always looks the same. `gradient` uses the shared defs of the hero; without it the
 * body is a flat niche color, which is what the small icons in the cards use.
 */
export function GlyphArt({ name, niche, gradient }: { name: string; niche: number; gradient: boolean }) {
  const g = glyphSpec(name);
  const color = `var(${NICHE_VARS[niche] ?? NICHE_VARS[0]})`;
  const gap = g.eyeGap;
  return (
    <g>
      {g.crest === "antenna" && (
        <>
          <path d="M0 -.96V-1.36" style={{ stroke: color, strokeWidth: 0.09, strokeLinecap: "round" }} />
          <circle cy={-1.4} r={0.15} style={{ fill: color }} />
        </>
      )}
      {g.crest === "ears" && (
        <>
          <rect x={-1.2} y={-0.34} width={0.34} height={0.68} rx={0.17} style={{ fill: color, opacity: 0.8 }} />
          <rect x={0.86} y={-0.34} width={0.34} height={0.68} rx={0.17} style={{ fill: color, opacity: 0.8 }} />
        </>
      )}
      {g.crest === "horns" && (
        <>
          <path d="M-.78 -.82L-.62 -1.34L-.28 -.9Z" style={{ fill: color, opacity: 0.85 }} />
          <path d="M.78 -.82L.62 -1.34L.28 -.9Z" style={{ fill: color, opacity: 0.85 }} />
        </>
      )}
      <rect x={-1} y={-1} width={2} height={2} rx={0.52} style={{ fill: gradient ? `url(#af-body-${niche})` : color }} />
      <path d="M-.82 -.3Q-.82 -.84 -.3 -.86H.3Q.82 -.84 .82 -.3Q0 -.56 -.82 -.3Z" style={{ fill: "#fff", opacity: 0.17 }} />

      {g.eyes === "dot" && (
        <>
          <circle cx={-gap} cy={-0.1} r={0.125} style={INK} />
          <circle cx={gap} cy={-0.1} r={0.125} style={INK} />
        </>
      )}
      {g.eyes === "pill" && (
        <>
          <rect x={-gap - 0.09} y={-0.3} width={0.18} height={0.4} rx={0.09} style={INK} />
          <rect x={gap - 0.09} y={-0.3} width={0.18} height={0.4} rx={0.09} style={INK} />
        </>
      )}
      {g.eyes === "happy" && (
        <>
          <path d={`M${-gap - 0.14} 0Q${-gap} -.24 ${-gap + 0.14} 0`} style={{ ...STROKE, strokeWidth: 0.1 }} />
          <path d={`M${gap - 0.14} 0Q${gap} -.24 ${gap + 0.14} 0`} style={{ ...STROKE, strokeWidth: 0.1 }} />
        </>
      )}
      {g.eyes === "visor" && <rect x={-gap - 0.17} y={-0.24} width={gap * 2 + 0.34} height={0.24} rx={0.12} style={INK} />}

      {g.mouth === "flat" && <path d="M-.17 .42H.17" style={{ ...STROKE, strokeWidth: 0.09 }} />}
      {g.mouth === "smile" && <path d="M-.22 .34Q0 .56 .22 .34" style={{ ...STROKE, strokeWidth: 0.09 }} />}
      {g.mouth === "round" && <circle cy={0.42} r={0.1} style={INK} />}

      {g.cheeks === "dots" && (
        <>
          <circle cx={-0.62} cy={0.3} r={0.075} style={{ ...INK, opacity: 0.4 }} />
          <circle cx={0.62} cy={0.3} r={0.075} style={{ ...INK, opacity: 0.4 }} />
        </>
      )}
      {g.cheeks === "stripes" && (
        <>
          <path d="M-.7 .22L-.58 .42M-.58 .18L-.46 .38" style={{ ...STROKE, strokeWidth: 0.05, opacity: 0.4 }} />
          <path d="M.7 .22L.58 .42M.58 .18L.46 .38" style={{ ...STROKE, strokeWidth: 0.05, opacity: 0.4 }} />
        </>
      )}
      {g.badge >= 0 && <circle cx={g.badge % 2 ? 0.7 : -0.7} cy={g.badge < 2 ? -0.7 : 0.7} r={0.11} style={{ ...INK, opacity: 0.55 }} />}
    </g>
  );
}

/** A small flat glyph for the cards. Decorative: the card text carries the meaning. */
export function GlyphIcon({ name, niche, size = 28 }: { name: string; niche: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-1.5 -1.7 3 3.1" aria-hidden="true" focusable="false" style={{ flex: "none" }}>
      <GlyphArt name={name} niche={niche} gradient={false} />
    </svg>
  );
}
