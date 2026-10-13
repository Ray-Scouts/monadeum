import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// The landing's CSS module is a build artifact Bun does not produce; class names stand in for it.
mock.module("@/app/_landing/landing.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));
const { AGENTS, CENTER, LOOP, glyphSpec, hashName, phaseAt, positionAt, sceneAt } = await import("./agentModel");
const { EvidenceStripView, proofCounts } = await import("./EvidenceStrip");

const cat = (n: number) => ({ count: n, items: [] });
const doc = {
  generatedAt: "2026-10-13T07:45:33.000Z",
  chainId: 10143,
  indexedThrough: "1",
  events: { deployed: cat(3), limitsSet: cat(3), callAllowed: cat(9), spent: cat(2) },
  reallocations: { moved: cat(0), retired: cat(0), evaluationsAdvanced: cat(0) },
  trades: cat(0),
  payments: cat(1),
};

describe("agent marks", () => {
  test("a name always gives the same mark, and the sample agents are not all alike", () => {
    expect(hashName("Nimbus·3c1d")).toBe(hashName("Nimbus·3c1d"));
    expect(glyphSpec("Orca·19bd")).toEqual(glyphSpec("Orca·19bd"));
    const marks = new Set(AGENTS.map((a) => JSON.stringify(glyphSpec(a.name))));
    expect(marks.size).toBeGreaterThanOrEqual(AGENTS.length - 2);
  });

  test("agent ids are unique and no agent leaves the circle at any time", () => {
    expect(new Set(AGENTS.map((a) => a.id)).size).toBe(AGENTS.length);
    for (const a of AGENTS) {
      for (let t = 0; t < 600; t += 7) {
        const p = positionAt(a, t);
        expect(Math.hypot(p.x - CENTER, p.y - CENTER) + a.size * 1.4).toBeLessThan(CENTER);
      }
    }
  });
});

describe("scenes", () => {
  test("the loop moves capital first, then rejects a proposal, and repeats", () => {
    expect(phaseAt(0.2)).toBe("idle");
    expect(phaseAt(3)).toBe("move");
    expect(phaseAt(8)).toBe("check");
    expect(phaseAt(11)).toBe("reject");
    expect(phaseAt(LOOP + 3)).toBe("move");
    expect(sceneAt(3).tags.map((t) => t.id)).toEqual(["nimbus", "kestrel"]);
    expect(sceneAt(11).tags[0]?.role).toBe("rejected");
  });

  test("the static frame for reduced motion shows the move and the rejection together", () => {
    const sc = sceneAt(null);
    expect(sc.phase).toBe("static");
    expect(sc.arcP).toBe(1);
    expect(sc.hold).toBe(1);
    expect(sc.tags.length).toBe(3);
  });
});

describe("evidence strip", () => {
  const html = (state: Parameters<typeof EvidenceStripView>[0]["state"]) => renderToStaticMarkup(<EvidenceStripView state={state} />);

  test("shows the counts the endpoint returned, and links to the evidence page", () => {
    expect(proofCounts(doc)).toEqual({ accounts: 3, spends: 2, trades: 0, payments: 1, generatedAt: doc.generatedAt });
    const out = html({ kind: "ready", counts: proofCounts(doc) });
    expect(out).toContain("agent accounts deployed");
    expect(out).toContain('href="/evidence"');
    expect(out).toContain(">3<");
  });

  test("fails closed: unavailable and loading never show a number", () => {
    for (const state of [{ kind: "unavailable", configured: true }, { kind: "unavailable", configured: false }, { kind: "loading" }] as const) {
      expect(html(state)).not.toMatch(/>\d+</);
    }
    expect(html({ kind: "unavailable", configured: true })).toContain("Unavailable");
  });
});

describe("dash rule", () => {
  test("the landing sources contain no em dash or en dash", async () => {
    const dir = new URL(".", import.meta.url).pathname;
    const bad = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
    for (const f of ["agentModel.ts", "AgentField.tsx", "AgentGlyph.tsx", "EvidenceStrip.tsx", "Landing.tsx", "landing.module.css"]) {
      const text = await Bun.file(dir + f).text();
      for (const c of bad) expect(text.includes(c)).toBe(false);
    }
  });
});
