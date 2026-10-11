import { ApiCreateAgent } from "@/components/api/CreateAgent";
import { ScreenHead, SampleBadge } from "@/components/ui";
import { USES_API } from "@/data/config";
import { SAMPLE_PAIRS } from "@/data/mock";
import { CreateFlow } from "./_components/CreateFlow";

export const metadata = { title: "Create your agent" };

export default function CreatePage() {
  if (USES_API) return <ApiCreateAgent />;
  return (
    <>
      <ScreenHead title="Create your agent" aside={<SampleBadge>Simulated: nothing is created</SampleBadge>}>
        Four steps. No blockchain knowledge needed: we create its smart account and sponsor the setup gas.
      </ScreenHead>
      <CreateFlow pairs={[...SAMPLE_PAIRS]} />
    </>
  );
}
