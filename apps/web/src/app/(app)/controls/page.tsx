import { ScreenHead } from "@/components/ui";
import { getSource } from "@/data/source";
import { agentLabel } from "@/lib/format";
import { BreakerCard } from "./_components/BreakerCard";
import { EmergencyStop } from "./_components/EmergencyStop";
import { LimitsCard } from "./_components/LimitsCard";
import { OperatingMode } from "./_components/OperatingMode";
import { RecoveryPanel, type PickableAgent } from "./_components/RecoveryPanel";

export const metadata = { title: "Controls and safety" };

export default async function ControlsPage() {
  const source = getSource();
  const [agents, limits, breaker] = await Promise.all([source.listAgents(), source.getLimits(), source.getBreaker()]);
  const live = agents.filter((a) => a.status !== "retired");
  const picks: PickableAgent[] = live
    .slice(0, 6)
    .map(({ id, name, capital, genome, status }) => ({ id, name, capital, genome, status }));
  // a retired agent's balance stays withdrawable, so it stands in for the recovery that already ran this window
  const prior = agents.find((a) => a.status === "retired") ?? live[live.length - 1];

  return (
    <>
      <ScreenHead title="Controls and safety">
        Layered limits: the chain rejects anything over the caps even if the application fails. You can stop any agent at any time.
      </ScreenHead>
      <OperatingMode agentLabel={live[0] ? agentLabel(live[0]) : "this agent"} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LimitsCard limits={limits} />
        <div className="flex min-w-0 flex-col gap-5">
          <BreakerCard breaker={breaker} />
          <EmergencyStop />
        </div>
      </div>
      <RecoveryPanel agents={picks} priorAgentId={prior?.id ?? null} />
    </>
  );
}
