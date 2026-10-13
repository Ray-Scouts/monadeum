"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Card, CardHead } from "@/components/ui";
import { FUNDING_NOTE, genomeSummary } from "@/data/api/create";
import { firstRunSteps, ownerNextStep } from "@/data/api/firstrun";
import { amount, explainAgent } from "@/data/api/present";
import type { ApiAgent } from "@/data/api/types";
import type { Operation } from "@/data/api/types";
import { WEB_CONFIG } from "@/data/config";
import { useSession } from "./auth";
import { ErrorNote, errorText } from "./ErrorNote";
import { CardFundingNotice } from "./CardFundingNotice";
import { FundAgent } from "./FundAgent";
import { OperationSigner } from "./OperationSigner";
import { ActivateAgent } from "./ActivateAgent";
import { FirstRunChecklist, NextStepCard } from "./FirstRun";
import { StopAgent } from "./StopAgent";
import { useApiData } from "./useApiData";
import { EventFeed } from "@/app/(app)/events/_components/EventFeed";
import { ScreenHead } from "@/components/ui";
import { feedEvents } from "@/data/api/present";
import { AgentFacts, AgentNotServed, ApiX402Split, CapitalFlowView, CapitalHistoryCard, EarningsCard, ExplainerCard, LiveBadge, PopulationView, SpendsTable } from "./views";

const settlement = WEB_CONFIG.settlement;

function Loading() {
  return (
    <p role="status" className="text-muted">
      Loading from the API…
    </p>
  );
}

/** The dashboard's pointer for a new owner: create the first agent, or finish the next step of the newest unfinished one. */
export function GetStarted({ agents }: { agents: ApiAgent[] }) {
  if (agents.length === 0) {
    return (
      <Card>
        <CardHead title="Create your first agent" />
        <p className="text-sm text-muted">You have no agents yet. Creating one takes a single step with the recommended settings, on the Monad testnet.</p>
        <Link href="/create" className="btn btn-primary mt-3 w-full sm:w-auto">
          Create your first agent
        </Link>
      </Card>
    );
  }
  const next = ownerNextStep(agents, settlement);
  return next ? <NextStepCard agentName={next.agent.name} agentId={next.agent.id} step={next.step} /> : null;
}

export function ApiPopulation() {
  const { data, error } = useApiData(async (s) => {
    const [population, mine, owner] = await Promise.all([s.population(), s.agents(), s.owner()]);
    return { population, agents: mine.agents, owner };
  }, "population");
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;
  return (
    <>
      <ErrorNote error={error} />
      <GetStarted agents={data.agents} />
      <PopulationView population={data.population} agents={data.agents} owner={data.owner} settlement={settlement} />
    </>
  );
}

export function ApiCapitalFlow() {
  const { data, error } = useApiData(async (s) => {
    const [flow, mine, owner] = await Promise.all([s.capitalFlow(), s.agents(), s.owner()]);
    return { flow, agents: mine.agents, owner };
  }, "capital-flow");
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;
  return (
    <>
      <ErrorNote error={error} />
      <CapitalFlowView flow={data.flow} agents={data.agents} owner={data.owner} settlement={settlement} />
    </>
  );
}

/** Retries an agent's deployment through the owner-signed relay, for an account that is not deployed. */
function Redeploy({ agentId, name, pending, onDone }: { agentId: string; name: string; pending: boolean; onDone(): void }) {
  const session = useSession();
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function start() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      setOperation((await session.redeploy(agentId)).operation);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const finished = operation && (operation.status === "succeeded" || operation.status === "failed");
  return (
    <Card>
      <CardHead title="Account deployment" />
      <p className="text-sm text-muted">
        {pending
          ? "This agent's deployment was started but has not finished. If it was interrupted, start it again here. Your owner wallet signs it and the platform pays the network fee."
          : "This agent's smart account is not deployed yet. Your owner wallet signs one approval and the platform pays the network fee. Funding and activation open once it is deployed."}
      </p>
      {!operation && (
        <button type="button" className="btn mt-3" disabled={busy} onClick={() => void start()}>
          {pending ? "Continue the deployment" : "Deploy the account"}
        </button>
      )}
      {operation && !finished && (
        <div className="mt-3">
          <OperationSigner operation={operation} name={() => name} onChange={(op) => {
              setOperation(op);
              if (op.status === "succeeded" || op.status === "failed") onDone();
            }}
          />
        </div>
      )}
      {finished && (
        <p role="status" className="mt-3 text-sm">
          {operation.status === "succeeded" ? "Deployment finished." : "Deployment did not finish, so the account is still not deployed. Choose Deploy the account to start it again."}
        </p>
      )}
      <p role="alert" className="mt-2 text-sm text-bad empty:hidden">
        {error}
      </p>
    </Card>
  );
}

/** The committed strategy in plain language, and whether the agent is funded. */
function StrategyCard({ agent }: { agent: ApiAgent }) {
  const unfunded = agent.principal === null || agent.principal === "0";
  return (
    <Card>
      <CardHead title="Strategy and funding" />
      {agent.genome ? (
        <>
          <ul className="m-0 grid list-disc gap-1 pl-5 text-sm">
            {genomeSummary(agent.genome).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="long-value mt-2 font-mono text-xs text-faint">
            {agent.genome.preset ? `Preset ${agent.genome.preset}, ` : ""}genome hash {agent.genome.hash}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">The API has no committed genome for this agent.</p>
      )}
      <p className="mt-3 text-sm">
        Principal: {agent.principal === null ? "not recorded" : amount(agent.principal, settlement)}
        {agent.status ? `. Worker status: ${agent.status}.` : "."}
      </p>
      {unfunded && (
        <p role="note" className="mt-2 rounded-xl border border-warn bg-warn-wash px-4 py-3 text-sm text-warn">
          {FUNDING_NOTE}
        </p>
      )}
    </Card>
  );
}

export function ApiAgent({ id }: { id: string }) {
  const { data, error, reload } = useApiData(async (s) => {
    const [detail, owner, flow] = await Promise.all([s.agent(id), s.owner(), s.capitalFlow()]);
    return { ...detail, owner, flow };
  }, `agent:${id}`);
  const back = (
    <Link href="/population" className="btn btn-ghost self-start pl-2">
      <Icon name="back" />
      Population
    </Link>
  );
  if (!data) return error ? <>{back}<ErrorNote error={error} /></> : <>{back}<Loading /></>;
  const { agent, spends, owner, flow } = data;
  return (
    <>
      {back}
      <ErrorNote error={error} />
      <AgentFacts
        agent={agent}
        settlement={settlement}
        actions={
          <>
            <FirstRunChecklist steps={firstRunSteps(agent, settlement)} />
            {agent.deployment === "deployed" && agent.session?.status !== "revoking" && (
              <div id="activate" className="scroll-mt-4">
                <ActivateAgent agent={agent} onChanged={reload} />
              </div>
            )}
            <StopAgent agent={agent} onChanged={reload} />
          </>
        }
      />
      {agent.deployment !== "deployed" && (
        <div id="account" className="scroll-mt-4">
          <Redeploy agentId={agent.id} name={agent.name} pending={agent.deployment === "pending"} onDone={reload} />
        </div>
      )}
      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <CapitalHistoryCard agent={agent} settlement={settlement} />
        <StrategyCard agent={agent} />
      </div>
      <EarningsCard agent={agent} settlement={settlement} />
      {agent.deployment === "deployed" && (
        <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div id="fund" className="min-w-0 scroll-mt-4">
            <FundAgent agent={agent} onChanged={reload} />
          </div>
          <CardFundingNotice />
        </div>
      )}
      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ExplainerCard explainer={explainAgent(agent, owner, { flow, settlement })} owner={owner} />
        <ApiX402Split x402={agent.x402} title="x402 spend" scope="this agent, by provider" settlement={settlement} />
      </div>
      <Card>
        <CardHead title="Spends" />
        <SpendsTable spends={spends} settlement={settlement} />
      </Card>
      <AgentNotServed agent={agent} />
    </>
  );
}

/**
 * The selection event feed in api mode: retirements and the reallocations the worker submitted, from the API's
 * `GET /events`, refreshed with the other screens. Policy-engine decisions are not served, so the feed says so.
 */
export function ApiEvents() {
  const { data, error } = useApiData(async (s) => {
    const [events, mine] = await Promise.all([s.events(), s.agents()]);
    return { events: events.events, agents: mine.agents };
  }, "events");
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;
  const names = new Map(data.agents.map((a) => [a.id, a.name]));
  return (
    <>
      <ErrorNote error={error} />
      <EventFeed
        events={feedEvents(data.events, names, settlement)}
        labels={Object.fromEntries(names)}
        heading={
          <ScreenHead title="Selection events" aside={<LiveBadge />}>
            Reallocations between your agents and retirements, from the worker&apos;s evaluation records. What the policy engine blocked is not served here yet.
          </ScreenHead>
        }
      />
    </>
  );
}
