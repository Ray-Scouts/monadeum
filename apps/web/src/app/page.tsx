import { USES_API } from "@/data/config";
import { Home } from "./_landing/Home";

export default function HomePage() {
  return <Home api={USES_API} />;
}
