import { buildSitemapXml } from "@/lib/site";

export const dynamic = "force-static";

/** `/sitemap.xml`: the canonical public pages, from the same list the markdown negotiation uses. */
export function GET(): Response {
  return new Response(buildSitemapXml(), { headers: { "content-type": "application/xml; charset=utf-8" } });
}
