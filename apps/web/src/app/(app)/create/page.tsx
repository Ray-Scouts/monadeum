import { NotServedScreen } from "@/components/api/views";
import { ScreenHead, SampleBadge } from "@/components/ui";
import { USES_API } from "@/data/config";
import { SAMPLE_PAIRS } from "@/data/mock";
import { CreateFlow } from "./_components/CreateFlow";

export const metadata = { title: "Create your agent" };

export default function CreatePage() {
  if (USES_API) {
    return (
      <NotServedScreen title="Create your agent">
        Creating an agent from this screen is not connected to the API yet: the API&apos;s creation endpoint does not collect a genome yet, and that work is in
        progress separately. Until it lands, this screen does not offer a creation it cannot complete.
      </NotServedScreen>
    );
  }
  return (
    <>
      <ScreenHead title="Create your agent" aside={<SampleBadge>Simulated: nothing is created</SampleBadge>}>
        Four steps. No blockchain knowledge needed: we create its smart account and sponsor the setup gas.
      </ScreenHead>
      <CreateFlow pairs={[...SAMPLE_PAIRS]} />
    </>
  );
}
