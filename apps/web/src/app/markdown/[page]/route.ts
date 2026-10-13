import { markdownResponse } from "@/lib/markdown";

/**
 * The target of the `Accept: text/markdown` rewrites in next.config.ts for `/` and `/evidence`. Not a public page: it
 * is disallowed in robots.txt and absent from the sitemap.
 */
export async function GET(_request: Request, context: { params: Promise<{ page: string }> }): Promise<Response> {
  const { page } = await context.params;
  return markdownResponse(page);
}
