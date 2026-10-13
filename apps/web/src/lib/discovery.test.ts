import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GET as apiCatalog } from "@/app/.well-known/api-catalog/route";
import { GET as markdownRoute } from "@/app/markdown/[page]/route";
import { GET as robots } from "@/app/robots.txt/route";
import { GET as sitemap } from "@/app/sitemap.xml/route";
import { estimateTokens, EVIDENCE_MARKDOWN, HOME_MARKDOWN, markdownFor, MARKDOWN_PAGES, markdownResponse } from "./markdown";
import {
  APP_ROUTE_SEGMENTS,
  buildApiCatalog,
  buildHomeLinkHeader,
  buildRobotsTxt,
  buildSitemapXml,
  CONTENT_SIGNAL,
  PUBLIC_PAGES,
  SEARCH_CRAWLERS,
  toOrigin,
  TRAINING_CRAWLERS,
} from "./site";

const APP_DIR = join(import.meta.dir, "..", "app");
const SITE = "https://app.monadeum.xyz";
const API = "https://api.monadeum.xyz";

interface Group {
  agents: string[];
  rules: { key: string; value: string }[];
}

/** A small RFC 9309 reader: consecutive User-agent lines open a group; other lines before the next group belong to it. */
function parseRobots(text: string): { groups: Group[]; sitemaps: string[] } {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(":");
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === "sitemap") sitemaps.push(value);
    else if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current!.agents.push(value);
      lastWasAgent = true;
      continue;
    } else current?.rules.push({ key, value });
    lastWasAgent = false;
  }
  return { groups, sitemaps };
}

/** Longest matching rule wins; Allow beats Disallow on a tie (RFC 9309 section 2.2.2). Prefix match only, which is all these rules use. */
function allowed(group: Group, path: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  for (const r of group.rules) {
    if ((r.key !== "allow" && r.key !== "disallow") || !path.startsWith(r.value) || r.value === "") continue;
    const allow = r.key === "allow";
    if (!best || r.value.length > best.len || (r.value.length === best.len && allow)) best = { len: r.value.length, allow };
  }
  return best ? best.allow : true;
}

describe("the app route list", () => {
  test("lists every directory of the (app) group, and each public page exists as a route", () => {
    const dirs = readdirSync(join(APP_DIR, "(app)"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect([...APP_ROUTE_SEGMENTS].sort()).toEqual(dirs.sort());
    for (const p of PUBLIC_PAGES) {
      const dir = p.path === "/" ? APP_DIR : join(APP_DIR, p.path.slice(1));
      expect(existsSync(join(dir, "page.tsx"))).toBe(true);
    }
  });
});

describe("robots.txt", () => {
  const text = buildRobotsTxt(SITE);
  const { groups, sitemaps } = parseRobots(text);
  const groupFor = (agent: string) => groups.find((g) => g.agents.includes(agent))!;

  test("is served as UTF-8 plain text with status 200", async () => {
    const res = robots();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toContain("User-agent: *");
  });

  test("blocks the training crawlers completely", () => {
    for (const agent of TRAINING_CRAWLERS) {
      const g = groupFor(agent);
      expect(allowed(g, "/")).toBe(false);
      expect(allowed(g, "/evidence")).toBe(false);
    }
    expect(TRAINING_CRAWLERS).toEqual(["GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "Applebot-Extended"]);
  });

  test("lets search and general crawlers read the public pages and no app route", () => {
    for (const agent of [...SEARCH_CRAWLERS, "*"]) {
      const g = groupFor(agent);
      for (const p of PUBLIC_PAGES) expect(allowed(g, p.path)).toBe(true);
      for (const s of APP_ROUTE_SEGMENTS) {
        expect(allowed(g, `/${s}`)).toBe(false);
        expect(allowed(g, `/${s}/anything`)).toBe(false);
      }
      expect(allowed(g, "/markdown/home")).toBe(false);
    }
  });

  test("states the content signals in the groups that allow crawling, and one sitemap with an absolute URL", () => {
    for (const agent of [...SEARCH_CRAWLERS, "*"]) expect(groupFor(agent).rules).toContainEqual({ key: "content-signal", value: CONTENT_SIGNAL });
    expect(CONTENT_SIGNAL).toBe("ai-train=no, search=yes, ai-input=yes");
    expect(sitemaps).toEqual([`${SITE}/sitemap.xml`]);
  });
});

describe("sitemap.xml", () => {
  test("is XML, status 200, and lists only the public pages as absolute URLs", async () => {
    const res = sitemap();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = buildSitemapXml(SITE);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${SITE}/`, `${SITE}/evidence`, `${SITE}/login`]);
    for (const s of APP_ROUTE_SEGMENTS) expect(xml).not.toContain(`/${s}`);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  });
});

describe("Link header", () => {
  test("points to the catalog and the docs site, and drops the catalog link without an API origin", () => {
    expect(buildHomeLinkHeader(API, "https://docs.monadeum.xyz")).toBe('</.well-known/api-catalog>; rel="api-catalog", <https://docs.monadeum.xyz>; rel="service-doc"');
    expect(buildHomeLinkHeader(null, "https://docs.monadeum.xyz")).toBe('<https://docs.monadeum.xyz>; rel="service-doc"');
  });
});

describe("api catalog", () => {
  test("is a linkset anchored at the API with documentation, a status endpoint, and no service-desc", () => {
    const doc = buildApiCatalog(API, "https://docs.monadeum.xyz");
    const parsed = JSON.parse(JSON.stringify(doc));
    expect(Array.isArray(parsed.linkset)).toBe(true);
    const [root, evidence] = parsed.linkset;
    expect(root.anchor).toBe(API);
    expect(root["service-doc"][0].href).toBe("https://docs.monadeum.xyz");
    expect(root.status[0].href).toBe(`${API}/health`);
    expect(evidence.anchor).toBe(`${API}/public/evidence`);
    for (const entry of parsed.linkset) expect("service-desc" in entry).toBe(false);
  });

  test("the route answers 404 when no API origin is configured (the test environment sets none)", async () => {
    const res = apiCatalog();
    expect(res.status).toBe(404);
  });

  test("origins are normalized and malformed values are rejected", () => {
    expect(toOrigin("https://api.monadeum.xyz/")).toBe(API);
    expect(toOrigin("nonsense")).toBeNull();
    expect(toOrigin(undefined)).toBeNull();
  });
});

describe("markdown", () => {
  test("serves the public pages with the right headers and a token estimate", async () => {
    for (const [path, name] of Object.entries(MARKDOWN_PAGES)) {
      const res = await markdownRoute(new Request(`http://x${path}`), { params: Promise.resolve({ page: name }) });
      const body = await res.text();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
      expect(res.headers.get("vary")).toBe("Accept");
      expect(res.headers.get("x-markdown-tokens")).toBe(String(estimateTokens(body)));
      expect(body.startsWith("# ")).toBe(true);
    }
    expect(Object.keys(MARKDOWN_PAGES)).toEqual(["/", "/evidence"]);
  });

  test("unknown names are 404", () => {
    expect(markdownResponse("population").status).toBe(404);
    expect(markdownFor("login")).toBeNull();
  });

  test("states no dated status and no claim that trades or payments happened", () => {
    for (const md of [HOME_MARKDOWN, EVIDENCE_MARKDOWN]) {
      expect(md).not.toMatch(/20\d\d-\d\d-\d\d/);
      expect(md).not.toMatch(/\bhas (executed|recorded) /i);
    }
  });
});
