"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Card, CardHead } from "@/components/ui";
import { FUNDING_NOTE, genomeSummary } from "@/data/api/create";
import { amount, explainAgent } from "@/data/api/present";
import type { ApiAgent } from "@/data/api/types";
import type { Operation } from "@/data/api/types";
import { WEB_CONFIG } from "@/data/config";
import { useSession } from "./auth";
import { ErrorNote, errorText } from "./ErrorNote";
import { OperationSigner } from "./OperationSigner";
import { StopAgent } from "./StopAgent";
import { useApiData } from "./useApiData";
import { AgentFacts, CapitalFlowView, ExplainerCard, NotServed, PopulationView, SpendsTable } from "./views";

const settlement = WEB_CONFIG.settlement;

function Loading() {
  return (
    <p role="status" className="text-muted">
      Loading from the API…
    </p>
  );
}

export function ApiPopulation() {
  const { data, error } = useApiData(async (s) => {
    const [population, mine] = await Promise.all([s.population(), s.agents()]);
    return { population, agents: mine.agents };
  }, "population");
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;
  return (
    <>
      <ErrorNote error={error} />
      <PopulationView population={data.population} agents={data.agents} settlement={settlement} />
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
function Redeploy({ agentId, name, onDone }: { agentId: string; name: string; onDone(): void }) {
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
      <p className="text-sm text-muted">This agent&apos;s smart account is not deployed. Deployment is signed by your owner wallet.</p>
      {!operation && (
        <button type="button" className="btn mt-3" disabled={busy} onClick={() => void start()}>
          Deploy the account
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
          {operation.status === "succeeded" ? "Deployment finished." : `Deployment failed (${operation.error ?? "unknown"}). You can start it again.`}
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
          <p className="mt-2 font-mono text-xs text-faint">
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
    const [detail, owner] = await Promise.all([s.agent(id), s.owner()]);
    return { ...detail, owner };
  }, `agent:${id}`);
  const back = (
    <Link href="/population" className="btn btn-ghost self-start pl-2">
      <Icon name="back" />
      Population
    </Link>
  );
  if (!data) return error ? <>{back}<ErrorNote error={error} /></> : <>{back}<Loading /></>;
  const { agent, spends, owner } = data;
  return (
    <>
      {back}
      <ErrorNote error={error} />
      <AgentFacts agent={agent} settlement={settlement} actions={<StopAgent agent={agent} onChanged={reload} />} />
      {agent.deployment !== "deployed" && <Redeploy agentId={agent.id} name={agent.name} onDone={reload} />}
      <StrategyCard agent={agent} />
      <ExplainerCard explainer={explainAgent(agent, owner)} />
      <Card>
        <CardHead title="Spends" />
        <SpendsTable spends={spends} settlement={settlement} />
      </Card>
      <NotServed fields={["capital", "net earnings after costs", "fitness", "trades", "x402 purchases", "evaluation outcome"]} />
    </>
  );
}
