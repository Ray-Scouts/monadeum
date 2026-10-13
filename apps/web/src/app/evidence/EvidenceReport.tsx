import type { ReactNode } from "react";
import { verifyCommands } from "@/data/evidence/commands";
import { CONTRACT_NAMES, DEPLOYMENT, RECORDED_CAPITAL_FLOOR, type DeploymentRecord } from "@/data/evidence/deployments";
import { CHAIN_ID, EVIDENCE_EXPLORER, EVIDENCE_RPC } from "@/data/evidence/explorer";
import { ago, BASE_DECIMALS, units, usdc, utc } from "@/data/evidence/format";
import type { Evidence, Verification } from "@/data/evidence/types";
import { keys } from "@/data/evidence/verify";
import { allOf, CopyValue, Empty, Hash, Records, Section, VerifyBadge, type Column } from "./parts";

export interface ReportProps {
  evidence: Evidence | null;
  /** Whether an API URL is configured at all; without one the document sections say so rather than show zeros. */
  apiConfigured: boolean;
  error: string | null;
  results: ReadonlyMap<string, Verification>;
  busy: boolean;
  checkedAt: number | null;
  now: number;
  onRefresh(): void;
  deployment?: DeploymentRecord;
}

const EVENT_LIMIT_NOTE = "Showing the latest records the endpoint lists (at most 50 per category); the count is the number in the store.";

function Unavailable({ apiConfigured, error }: { apiConfigured: boolean; error: string | null }) {
  return (
    <Empty>
      Not loaded. {apiConfigured ? (error ?? "Waiting for the evidence endpoint.") : "This deployment has no API configured, so the indexed records cannot be listed."} This is not a count of zero: nothing is claimed for this category until the document is read.
    </Empty>
  );
}

const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-[13px] break-all">{children}</span>;

export function EvidenceReport(props: ReportProps) {
  const { evidence: e, results, apiConfigured, error } = props;
  const d = props.deployment ?? DEPLOYMENT;
  const r = (key: string) => results.get(key);
  const chain = r(keys.chain);
  const generated = e ? Date.parse(e.generatedAt) : null;

  const contractRows = CONTRACT_NAMES.map((name) => ({ name, address: d.contracts[name], tx: d.transactions[name] }));
  const reallocation = d.contracts.AgentReallocation;
  const reads: { label: string; recorded: string; key: string }[] = [
    { label: "AgentReallocation operator()", recorded: d.inputs.reallocationOperator, key: keys.read(reallocation, "operator") },
    { label: "AgentReallocation admin()", recorded: d.inputs.reallocationAdmin, key: keys.read(reallocation, "admin") },
    { label: "AgentReallocation minEvaluationInterval()", recorded: String(d.inputs.minEvaluationInterval), key: keys.read(reallocation, "minEvaluationInterval") },
    { label: "AgentReallocation capitalFloor()", recorded: String(RECORDED_CAPITAL_FLOOR), key: keys.read(reallocation, "capitalFloor") },
    ...CONTRACT_NAMES.map((n) => ({ label: `${n} settlementAsset()`, recorded: d.inputs.settlementAsset, key: keys.read(d.contracts[n], "settlementAsset") })),
    { label: "Safe getThreshold()", recorded: String(d.safe.threshold), key: keys.read(d.safe.address, "getThreshold") },
    { label: "Safe getOwners()", recorded: `${d.safe.owners.length} owners listed in the record`, key: keys.read(d.safe.address, "getOwners") },
  ];

  const contractCols: Column<(typeof contractRows)[number]>[] = [
    { id: "name", header: "Contract", cell: (c) => <strong>{c.name}</strong> },
    { id: "address", header: "Address", cell: (c) => <Hash kind="address" value={c.address} /> },
    { id: "tx", header: "Deployment tx", cell: (c) => <Hash kind="tx" value={c.tx.hash} /> },
    { id: "block", header: "Block", cell: (c) => <Hash kind="block" value={String(c.tx.block)} /> },
    { id: "gas", header: "Gas used", cell: (c) => <span className="tabular">{c.tx.gasUsed.toLocaleString("en-US")}</span> },
    {
      id: "check",
      header: "Chain check",
      cell: (c) => <VerifyBadge v={allOf([r(keys.deployTx(c.name)), r(keys.code(c.address)), r(keys.read(c.address, "settlementAsset"))])} />,
    },
  ];
  const readCols: Column<(typeof reads)[number]>[] = [
    { id: "label", header: "Read", cell: (x) => <span className="font-mono text-[13px]">{x.label}</span> },
    { id: "recorded", header: "Recorded", cell: (x) => <Mono>{x.recorded}</Mono> },
    { id: "check", header: "Chain says", cell: (x) => <VerifyBadge v={r(x.key)} /> },
  ];

  const deployed = e?.events.deployed.items ?? [];
  const agentCols: Column<(typeof deployed)[number]>[] = [
    { id: "account", header: "Account", cell: (a) => <Hash kind="address" value={a.account} /> },
    { id: "tx", header: "account.deployed tx", cell: (a) => <Hash kind="tx" value={a.transactionHash} /> },
    { id: "block", header: "Block", cell: (a) => <Hash kind="block" value={a.blockNumber} /> },
    { id: "code", header: "Account code", cell: (a) => <VerifyBadge v={r(keys.code(a.account))} /> },
    { id: "event", header: "Event check", cell: (a) => <VerifyBadge v={r(keys.event(a.transactionHash, a.logIndex))} /> },
  ];

  const limits = e?.events.limitsSet.items ?? [];
  const limitCols: Column<(typeof limits)[number]>[] = [
    { id: "account", header: "Account", cell: (a) => <Hash kind="address" value={a.account} /> },
    { id: "tx", header: "spend.limits-set tx", cell: (a) => <Hash kind="tx" value={a.transactionHash} /> },
    { id: "caps", header: "Per-tx / daily cap", cell: (a) => <span className="tabular">{usdc(a.perTxCap)} / {usdc(a.dailyCap)}</span> },
    { id: "check", header: "Chain check", cell: (a) => <VerifyBadge v={r(keys.event(a.transactionHash, a.logIndex))} /> },
  ];
  const allowed = e?.events.callAllowed.items ?? [];
  const allowedCols: Column<(typeof allowed)[number]>[] = [
    { id: "account", header: "Account", cell: (a) => <Hash kind="address" value={a.account} /> },
    { id: "tx", header: "spend.call-allowed tx", cell: (a) => <Hash kind="tx" value={a.transactionHash} /> },
    { id: "call", header: "Target and selector", cell: (a) => <span className="inline-flex flex-col gap-0.5"><Hash kind="address" value={a.target} /><Mono>{a.selector} {a.allowed ? "allowed" : "removed"}</Mono></span> },
    { id: "check", header: "Chain check", cell: (a) => <VerifyBadge v={r(keys.event(a.transactionHash, a.logIndex))} /> },
  ];
  const spent = e?.events.spent.items ?? [];
  const spentCols: Column<(typeof spent)[number]>[] = [
    { id: "account", header: "Account", cell: (a) => <Hash kind="address" value={a.account} /> },
    { id: "tx", header: "spend.spent tx", cell: (a) => <Hash kind="tx" value={a.transactionHash} /> },
    { id: "amount", header: "Amount / 24 h window total", cell: (a) => <span className="tabular">{usdc(a.amount)} / {usdc(a.windowTotal)}</span> },
    { id: "check", header: "Chain check", cell: (a) => <VerifyBadge v={r(keys.event(a.transactionHash, a.logIndex))} /> },
  ];

  const trades = e?.trades.items ?? [];
  const tradeCols: Column<(typeof trades)[number]>[] = [
    { id: "tx", header: "Fill tx", cell: (t) => <Hash kind="tx" value={t.transactionHash} /> },
    { id: "market", header: "Market, side", cell: (t) => <span>{t.pair} <strong className={t.side === "buy" ? "text-good" : "text-berry"}>{t.side}</strong></span> },
    { id: "size", header: "Size / quote", cell: (t) => <span className="tabular">{units(t.baseAmount, BASE_DECIMALS)} base / {usdc(t.quoteAmount)}</span> },
    { id: "price", header: "Price", cell: (t) => <span className="tabular">{units(t.executedPrice, 6)} USDC per base token</span> },
    { id: "fees", header: "Fee, gas", cell: (t) => <span className="tabular">{t.fee.asset === "quote" ? usdc(t.fee.amount) : `${units(t.fee.amount, BASE_DECIMALS)} base`} fee ({t.fee.source}){t.costs ? `, gas ${units(t.costs.gasWei, 18)} MON (${usdc(t.costs.gas)})` : ""}</span> },
    { id: "pnl", header: "Realized P&L", cell: (t) => <span className="tabular">{t.realizedPnl === null ? "none recorded for this fill" : usdc(t.realizedPnl)}</span> },
    { id: "check", header: "Chain check", cell: (t) => <VerifyBadge v={r(keys.trade(t.transactionHash))} /> },
  ];

  const payments = e?.payments.items ?? [];
  const payCols: Column<(typeof payments)[number]>[] = [
    { id: "provider", header: "Provider", cell: (p) => <strong>{p.provider}</strong> },
    { id: "amount", header: "Amount", cell: (p) => <span className="tabular">{usdc(p.price)}</span> },
    { id: "tx", header: "Payment tx", cell: (p) => <Hash kind="tx" value={p.settlementTransaction} /> },
    { id: "recon", header: "Reconciliation", cell: (p) => <span>{p.reconciliation === "settled" ? "settled" : `anomaly: ${p.anomaly}`}</span> },
    { id: "check", header: "Chain check", cell: (p) => <VerifyBadge v={r(keys.payment(p.settlementTransaction))} /> },
  ];

  const statuses = deployed.map((a) => ({ account: a.account, v: r(keys.agentStatus(a.account)) }));
  const statusCols: Column<(typeof statuses)[number]>[] = [
    { id: "account", header: "Account", cell: (s) => <Hash kind="address" value={s.account} /> },
    { id: "status", header: "AgentReallocation.agent(account).status", cell: (s) => <VerifyBadge v={s.v} /> },
  ];

  const spendPolicy = d.contracts.AgentSpendPolicy;
  const commands = verifyCommands(d, e);

  const summary: { label: string; value: string }[] = [
    { label: "Kernel accounts deployed", value: e ? String(e.events.deployed.count) : "not loaded" },
    { label: "Spend events indexed", value: e ? String(e.events.limitsSet.count + e.events.callAllowed.count + e.events.spent.count) : "not loaded" },
    { label: "Filled trades", value: e ? String(e.trades.count) : "not loaded" },
    { label: "x402 payments with a settlement tx", value: e ? String(e.payments.count) : "not loaded" },
    { label: "ERC-8004 identities", value: "0" },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 className="text-[clamp(26px,5vw,38px)] font-bold">On-chain evidence</h1>
        <p className="max-w-[68ch] text-muted">
          Everything on this page is tied to a transaction hash or a live contract read on Monad testnet (chain {CHAIN_ID}). Your browser re-reads each record from the public RPC; a record that cannot be matched to the chain is shown as unverified, never as verified.
        </p>
      </div>

      <div role="group" aria-label="Freshness" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card border border-line-soft bg-surface p-4 text-sm">
        <span className="min-w-0">
          Document: {generated ? <><time dateTime={e!.generatedAt}>{utc(generated)}</time> ({ago(generated, props.now)})</> : "not loaded"}
        </span>
        <span className="min-w-0">
          Chain checks: {props.busy ? "running" : props.checkedAt ? <><time dateTime={new Date(props.checkedAt).toISOString()}>{utc(props.checkedAt)}</time> ({ago(props.checkedAt, props.now)})</> : "not run"}
        </span>
        <span className="inline-flex min-w-0 items-center gap-2">RPC <VerifyBadge v={chain} /></span>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.busy}
          className="ml-auto inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-sm font-medium text-ink-fg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {props.busy ? "Refreshing" : "Refresh"}
        </button>
        <span role="status" className="sr-only">{props.busy ? "Refreshing the evidence and re-checking the chain" : "Evidence is up to date"}</span>
      </div>

      {error && (
        <p role="alert" className="rounded-[10px] border border-bad bg-bad-wash px-3.5 py-3 text-sm">
          The evidence endpoint could not be read: {error.replace(/\.?$/, ".")} The sections that depend on it show no records instead of zeros. The deployment checks below still run against the chain.
        </p>
      )}

      <dl aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {summary.map((s) => (
          <div key={s.label} className="min-w-0 rounded-[14px] border border-line-soft bg-surface px-4 py-3">
            <dt className="text-xs text-muted">{s.label}</dt>
            <dd className="font-display text-[26px] leading-tight font-bold tabular">{s.value}</dd>
          </div>
        ))}
      </dl>

      <Section id="deployments" title="Deployments" count="3 contracts" note={`From contracts/deployments/monad-testnet.json (status: ${d.status}), re-read from the chain. Settlement asset ${d.inputs.settlementAsset}, ${d.inputs.settlementDecimals} decimals. Total deployment gas ${d.cost.totalGas.toLocaleString("en-US")}, about ${d.cost.totalMon} MON at the recorded gas price.`}>
        <Records caption="Deployed contracts" rows={contractRows} columns={contractCols} rowKey={(c) => c.name} />
        <div className="grid gap-1 text-sm text-muted">
          <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2">Deployer <Hash kind="address" value={d.deployer} /></span>
          <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2">Safe (operator and admin, {d.safe.threshold} of {d.safe.owners.length}, version {d.safe.version}) <Hash kind="address" value={d.safe.address} /> <VerifyBadge v={r(keys.code(d.safe.address))} /></span>
          <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2">Settlement asset <Hash kind="address" value={d.inputs.settlementAsset} /></span>
        </div>
        <h3 className="mt-2 text-base font-bold">Live reads</h3>
        <Records caption="Live contract reads against the deployment record" rows={reads} columns={readCols} rowKey={(x) => x.key} />
      </Section>

      <Section id="agents" title="Agents" count={e ? `${e.events.deployed.count} Kernel accounts deployed` : "not loaded"} note={`An agent is counted once its account.deployed event is indexed. ${EVENT_LIMIT_NOTE}`}>
        {!e ? <Unavailable apiConfigured={apiConfigured} error={error} /> : deployed.length === 0 ? <Empty>0 agent accounts deployed on chain have been indexed. No account.deployed event exists in the read-model.</Empty> : <Records caption="Agent accounts" rows={deployed} columns={agentCols} rowKey={(a) => `${a.transactionHash}:${a.logIndex}`} />}
        <h3 className="mt-2 text-base font-bold">Spend limits set {e ? `(${e.events.limitsSet.count})` : ""}</h3>
        {!e ? <Unavailable apiConfigured={apiConfigured} error={error} /> : limits.length === 0 ? <Empty>0 spend.limits-set events indexed.</Empty> : <Records caption="spend.limits-set events" rows={limits} columns={limitCols} rowKey={(a) => `${a.transactionHash}:${a.logIndex}`} />}
        <h3 className="mt-2 text-base font-bold">Call allowlist changes {e ? `(${e.events.callAllowed.count})` : ""}</h3>
        {!e ? <Unavailable apiConfigured={apiConfigured} error={error} /> : allowed.length === 0 ? <Empty>0 spend.call-allowed events indexed.</Empty> : <Records caption="spend.call-allowed events" rows={allowed} columns={allowedCols} rowKey={(a) => `${a.transactionHash}:${a.logIndex}`} />}
      </Section>

      <Section id="spend-policy" title="Spend policy proof" count={e ? `${e.events.spent.count} accepted` : "not loaded"} note={`Accepted operations are the spend.spent events AgentSpendPolicy ${spendPolicy} emitted when it recorded a spend inside the limits.`}>
        {!e ? <Unavailable apiConfigured={apiConfigured} error={error} /> : spent.length === 0 ? <Empty>0 accepted operations recorded. No spend.spent event has been indexed.</Empty> : <Records caption="Accepted operations" rows={spent} columns={spentCols} rowKey={(a) => `${a.transactionHash}:${a.logIndex}`} />}
        <Empty>
          Rejected operations: 0 listed, and that is not a claim that none happened. A spend the contract refuses reverts and emits no event, and one the app-layer risk engine refuses never reaches the chain, so neither has a transaction hash this page could show.
        </Empty>
      </Section>

      <Section id="trades" title="Trades" count={e ? `${e.trades.count} filled` : "not loaded"} note={`Kuru fills recorded as filled by the worker, with the realized P&L its position store settled for each. Base amounts and prices use the 18-decimal base token and 6-decimal USDC of the testnet market. ${EVENT_LIMIT_NOTE}`}>
        {!e ? <Unavailable apiConfigured={apiConfigured} error={error} /> : trades.length === 0 ? <Empty>0 trades. No fill with a transaction hash has been recorded.</Empty> : <Records caption="Filled trades" rows={trades} columns={tradeCols} rowKey={(t) => t.transactionHash} />}
      </Section>

      <Section id="x402" title="x402 payments" count={e ? `${e.payments.count} with a settlement tx` : "not loaded"} note={`Payments the log records with a settlement transaction reference. A purchase with no settlement transaction is not listed and not counted. ${EVENT_LIMIT_NOTE}`}>
        {!e ? <Unavailable apiConfigured={apiConfigured} error={error} /> : payments.length === 0 ? <Empty>0 x402 payments. No payment with a settlement transaction has been recorded.</Empty> : <Records caption="x402 payments" rows={payments} columns={payCols} rowKey={(p) => p.settlementTransaction} />}
      </Section>

      <Section id="reallocation" title="Reallocations and retirements" note="Read live from AgentReallocation. The public RPC limits eth_getLogs to 100 blocks, so history is not scanned; the evaluation counter and each account's status are read directly.">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-[10px] border border-line-soft bg-surface-2 p-3"><dt className="text-xs text-muted">currentEvaluation(): reallocation evaluations advanced</dt><dd className="mt-1"><VerifyBadge v={r(keys.read(reallocation, "currentEvaluation"))} /></dd></div>
          <div className="rounded-[10px] border border-line-soft bg-surface-2 p-3"><dt className="text-xs text-muted">lastEvaluationAt(): timestamp of the latest one</dt><dd className="mt-1"><VerifyBadge v={r(keys.read(reallocation, "lastEvaluationAt"))} /></dd></div>
        </dl>
        <p className="text-sm text-muted">A currentEvaluation of 0 means no evaluation has been advanced on this contract, so no reallocation has been possible. Reallocation is also off by default in the platform.</p>
        {!e ? <Unavailable apiConfigured={apiConfigured} error={error} /> : statuses.length === 0 ? <Empty>0 agent accounts to read a status for, so 0 retirements can be shown.</Empty> : <Records caption="Agent status on AgentReallocation" rows={statuses} columns={statusCols} rowKey={(s) => s.account} />}
      </Section>

      <Section id="identity" title="Identity (ERC-8004)" count="0 registered">
        <Empty>0 ERC-8004 identities registered. The deployment record lists three contracts (AgentSpendPolicy, AgentReallocation, X402PaymentValidator) and no ERC-8004 registry, so there is nothing to read. This stays at 0 until a registry is deployed and recorded.</Empty>
      </Section>

      <Section id="verify" title="Verify it yourself" note={`Run these against ${EVIDENCE_RPC} with Foundry's cast or viem. They do not depend on this site. ${e ? "Hashes come from the records above." : "A class with no loaded record shows a placeholder."}`}>
        <div className="grid gap-3">
          {commands.map((c) => (
            <div key={c.id} className="min-w-0 rounded-[14px] border border-line-soft bg-surface-2 p-3.5">
              <h3 className="text-base font-bold">{c.title}</h3>
              <p className="mb-2 text-sm [overflow-wrap:anywhere] text-muted">Expect: {c.expect}</p>
              {(["cast", "viem"] as const).map((tool) => (
                <div key={tool} className="mb-2 last:mb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted">{tool}</span>
                    <CopyValue value={c[tool]} label={`${tool} command for ${c.title}`} />
                  </div>
                  <pre tabIndex={0} className="max-w-full overflow-x-auto rounded-lg bg-bg p-3 font-mono text-xs whitespace-pre-wrap break-all">{c[tool]}</pre>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Section>

      <aside aria-labelledby="not-shown-h" className="rounded-card border border-warn bg-warn-wash p-4 sm:p-5">
        <h2 id="not-shown-h" className="text-xl font-bold">What this page does not show</h2>
        <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-sm">
          <li>Skill. Testnet liquidity is seeded by the team, so profit and loss on testnet is not evidence of trading skill.</li>
          <li>Rejected operations. They leave no transaction, so there is no hash to list; the count above is not a claim that none happened.</li>
          <li>Reallocation. It is off by default, so a zero here is the expected state.</li>
          <li>Older history. Each list holds the latest 50 records; the RPC does not allow scanning wide log ranges.</li>
          <li>People. Owners, users, agent names, and session keys are not published. Agents appear only by their public account address.</li>
          <li>Mainnet. Everything here is Monad testnet, explorer {EVIDENCE_EXPLORER}.</li>
        </ul>
      </aside>
    </div>
  );
}
