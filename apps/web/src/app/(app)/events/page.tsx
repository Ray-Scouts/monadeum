import type { Metadata } from "next";
import { NotServedScreen } from "@/components/api/views";
import { SampleBadge, ScreenHead } from "@/components/ui";
import { USES_API } from "@/data/config";
import { getSource, IS_SAMPLE_DATA } from "@/data/source";
import { agentLabel } from "@/lib/format";
import { EventFeed } from "./_components/EventFeed";

export const metadata: Metadata = { title: "Selection events" };

export default async function Page() {
  if (USES_API) {
    return (
      <NotServedScreen title="Selection events">
        The API does not serve an event feed yet. Indexed reallocations are listed on the capital-flow screen, and each agent&apos;s retirement on its own page, but
        retirements and policy-engine decisions are not served as a feed, so this screen shows nothing rather than sample events.
      </NotServedScreen>
    );
  }
  const source = getSource();
  const [events, agents] = await Promise.all([source.listEvents(), source.listAgents()]);
  const labels = Object.fromEntries(agents.map((a) => [a.id, agentLabel(a)]));

  return (
    <EventFeed
      events={events}
      labels={labels}
      heading={
        <ScreenHead title="Selection events" aside={IS_SAMPLE_DATA ? <SampleBadge /> : undefined}>
          Reallocations between an owner's agents, retirements, and what the policy engine blocked and why.
        </ScreenHead>
      }
    />
  );
}
