import { buildRobotsTxt } from "@/lib/site";

export const dynamic = "force-static";

/** `/robots.txt` (RFC 9309): text/plain, UTF-8. */
export function GET(): Response {
  return new Response(buildRobotsTxt(), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
