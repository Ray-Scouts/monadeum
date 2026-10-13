// The public discovery surface of the web app: which pages are public, which routes are not, and the documents that
// describe them (crawler rules, sitemap, link headers, the API catalog). One source of truth for all of them; the route
// handlers, next.config.ts, and the tests read from here. It imports nothing from the app so next.config.ts can use it.

/** The production origins are configuration, not code: the web build sets NEXT_PUBLIC_MONADEUM_WEB_URL and NEXT_PUBLIC_MONADEUM_API_URL (deploy/docker-compose.yml). */
export function toOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return null;
  }
}

// Next.js inlines NEXT_PUBLIC_ variables only where they are written out literally.
export const SITE_URL: string = toOrigin(process.env.NEXT_PUBLIC_MONADEUM_WEB_URL) ?? "http://localhost:3000";
export const API_ORIGIN: string | null = toOrigin(process.env.NEXT_PUBLIC_MONADEUM_API_URL);

/** The documentation site is published separately (Mintlify, source in docs-site/). It is not served by this app. */
export const DOCS_URL = "https://docs.monadeum.xyz";
/** Mintlify serves docs-site/evidence/live-evidence.mdx at this path. ASSUMPTION: Mintlify's path convention, not checked against the live site. */
export const DOCS_EVIDENCE_URL = `${DOCS_URL}/evidence/live-evidence`;

/** Page descriptions, shared by the page metadata and the markdown versions so they cannot drift apart. */
export const HOME_DESCRIPTION = "Autonomous AI agents with their own capital on Monad. Agents that keep failing retire. Each agent runs on its own capital; reallocation between an owner's agents is off by default.";
export const EVIDENCE_DESCRIPTION = "Verify Monadeum's real usage on Monad testnet: deployed contracts, agent accounts, spend policy events, trades, and x402 payments, each tied to a transaction hash and re-checked against the chain in your browser.";

export interface PublicPage {
  path: string;
  /** Has a hand-written markdown version served for `Accept: text/markdown` (src/lib/markdown.ts). */
  markdown: boolean;
}

/** Canonical public pages that exist as routes outside the signed-in `(app)` group. Each is listed in the sitemap. */
export const PUBLIC_PAGES: readonly PublicPage[] = [
  { path: "/", markdown: true },
  { path: "/evidence", markdown: true },
  { path: "/login", markdown: false },
];

/**
 * First path segments of the routes in `src/app/(app)`: the signed-in app, and in `api` mode behind the session gate.
 * A test compares this list with the directory so a new screen cannot be left out.
 */
export const APP_ROUTE_SEGMENTS: readonly string[] = ["agents", "capital-flow", "controls", "create", "events", "population"];

/** The internal route behind markdown negotiation. It is not a page and not for crawlers. */
export const MARKDOWN_ROUTE = "/markdown";

/** Crawlers that fetch pages to answer a user's query or to build a search index. */
export const SEARCH_CRAWLERS: readonly string[] = ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"];
/** Crawlers and tokens used to gather model training data. */
export const TRAINING_CRAWLERS: readonly string[] = ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "Applebot-Extended"];

/** contentsignals.org: `ai-train`, `search`, `ai-input`, each `yes` or `no`, comma separated. */
export const CONTENT_SIGNAL = "ai-train=no, search=yes, ai-input=yes";

/**
 * robots.txt (RFC 9309). A crawler obeys the one group that matches it best, so each group is complete. The public
 * pages are allowed (`Allow: /`); the longest matching rule wins, so the disallowed prefixes take precedence. A bare
 * prefix such as `/agents` also matches `/agents/<id>`.
 */
export function buildRobotsTxt(siteUrl: string = SITE_URL): string {
  const rules = [`Content-Signal: ${CONTENT_SIGNAL}`, "Allow: /", ...[...APP_ROUTE_SEGMENTS.map((s) => `/${s}`), MARKDOWN_ROUTE].map((p) => `Disallow: ${p}`)];
  const group = (agents: readonly string[], lines: readonly string[]) => [...agents.map((a) => `User-agent: ${a}`), ...lines].join("\n");
  return [group(SEARCH_CRAWLERS, rules), group(TRAINING_CRAWLERS, ["Disallow: /"]), group(["*"], rules), `Sitemap: ${siteUrl}/sitemap.xml`].join("\n\n") + "\n";
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** sitemap.xml (sitemaps.org protocol 0.9): only `loc`, the one required child. No dates are claimed. */
export function buildSitemapXml(siteUrl: string = SITE_URL): string {
  const urls = PUBLIC_PAGES.map((p) => `  <url>\n    <loc>${xmlEscape(`${siteUrl}${p.path}`)}</loc>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export const API_CATALOG_PATH = "/.well-known/api-catalog";

/** The Link header (RFC 8288) of the home page. The catalog link is present only when an API origin is configured, because the catalog exists only then. */
export function buildHomeLinkHeader(apiOrigin: string | null = API_ORIGIN, docsUrl: string = DOCS_URL): string {
  const links: string[] = [];
  if (apiOrigin) links.push(`<${API_CATALOG_PATH}>; rel="api-catalog"`);
  links.push(`<${docsUrl}>; rel="service-doc"`);
  return links.join(", ");
}

/** Link header of the catalog response itself (RFC 9727: a response for the catalog signposts it). */
export const API_CATALOG_LINK_HEADER = `<${API_CATALOG_PATH}>; rel="api-catalog"`;

/**
 * The API catalog (RFC 9727) as a Linkset (RFC 9264). `status` is `GET /health` (apps/api/src/health.controller.ts).
 * There is no `service-desc`: the API has no OpenAPI or other machine-readable description document.
 */
export function buildApiCatalog(apiOrigin: string, docsUrl: string = DOCS_URL, evidenceDocsUrl: string = DOCS_EVIDENCE_URL) {
  return {
    linkset: [
      {
        anchor: apiOrigin,
        "service-doc": [{ href: docsUrl, type: "text/html" }],
        status: [{ href: `${apiOrigin}/health`, type: "application/json" }],
      },
      {
        // The one unauthenticated, read-only data endpoint (ARCHITECTURE.md section 10). Every other data endpoint needs a session.
        anchor: `${apiOrigin}/public/evidence`,
        "service-doc": [{ href: evidenceDocsUrl, type: "text/html" }],
      },
    ],
  };
}
