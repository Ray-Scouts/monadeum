import { API_CATALOG_LINK_HEADER, API_ORIGIN, buildApiCatalog } from "@/lib/site";

export const dynamic = "force-static";

/** `/.well-known/api-catalog` (RFC 9727). Without a configured API origin there is no API to describe, so it answers 404 rather than an empty or invented catalog. */
export function GET(): Response {
  if (!API_ORIGIN) return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(JSON.stringify(buildApiCatalog(API_ORIGIN), null, 2) + "\n", {
    headers: {
      "content-type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
      link: API_CATALOG_LINK_HEADER,
      "access-control-allow-origin": "*",
    },
  });
}
