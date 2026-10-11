import { ApiHome } from "@/components/api/gate";
import { Landing } from "./Landing";

/** `/`: the marketing landing in `sample` mode; in `api` mode nothing but a redirect, so no sample data is shown. */
export function Home({ api }: { api: boolean }) {
  return api ? <ApiHome /> : <Landing />;
}
