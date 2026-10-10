import type { Metadata } from "next";
import { SampleBadge, ScreenHead } from "@/components/ui";
import { getSource, IS_SAMPLE_DATA } from "@/data/source";
import { agentLabel } from "@/lib/format";
import { EventFeed } from "./_components/EventFeed";

export const metadata: Metadata = { title: "Selection events" };

export default async function Page() {
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
