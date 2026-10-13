import type { NextConfig } from "next";
import { buildHomeLinkHeader, MARKDOWN_ROUTE } from "./src/lib/site";

// The Link header lives here, not in deploy/Caddyfile: Caddy only terminates TLS and proxies to this app, so a header set
// here is the same wherever the app is served, and its targets track the same configuration (NEXT_PUBLIC_MONADEUM_API_URL)
// as the routes they point to. The one header Caddy adds is Vary, explained below.
const config: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      // RFC 8288 Link header on the home page. (`Vary: Accept` for the HTML of `/` and `/evidence` is added by Caddy, because
      // Next.js replaces a Vary set here with its own; the markdown response sets its own `Vary: Accept`.)
      { source: "/", headers: [{ key: "Link", value: buildHomeLinkHeader() }] },
    ];
  },
  async rewrites() {
    // Markdown content negotiation: a request that lists text/markdown in Accept gets the markdown version. Browsers do not send it.
    const accept = [{ type: "header" as const, key: "accept", value: ".*text/markdown.*" }];
    return {
      beforeFiles: [
        { source: "/", has: accept, destination: `${MARKDOWN_ROUTE}/home` },
        { source: "/evidence", has: accept, destination: `${MARKDOWN_ROUTE}/evidence` },
      ],
    };
  },
};

export default config;
