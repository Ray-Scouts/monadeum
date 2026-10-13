import type { ReactNode } from "react";
import { Pill } from "@/components/ui";
import { ENVIO_DOCS_URL, type CrossCheckView } from "@/data/evidence/crosscheck";
import { ago, utc } from "@/data/evidence/format";
import { Empty, Section } from "./parts";

const TITLE = "Independently cross-checked with Envio HyperSync";

const NOTE =
  "The API asks Envio HyperSync, a second and independent source of logs, for the events this page lists from the indexer (account deployments, spend policy events, reallocations) over the most recent block window, and compares them row by row. Trades and x402 payments are not read from logs, so they are not covered. This runs on the server: it checks the indexer, and the chain checks your browser runs below are the check on the server.";

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[14px] border border-line-soft bg-surface-2 px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="long-value font-mono text-[15px] tabular">{children}</dd>
    </div>
  );
}

function DocsLink() {
  return (
    <a href={ENVIO_DOCS_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 w-fit items-center underline underline-offset-2">
      Envio HyperSync documentation
    </a>
  );
}

/**
 * The Envio HyperSync cross-check of the indexed event rows. Only `match` is green. Not loaded, not running on this
 * server, unverified, and mismatch each say what they are; none is shown as passing.
 */
export function CrossCheckCard({ view, loaded, now }: { view: CrossCheckView; loaded: boolean; now: number }) {
  if (!loaded) {
    return (
      <Section id="crosscheck" title={TITLE} count="not loaded" note={NOTE}>
        <Empty>Not loaded. The cross-check is part of the evidence document, so nothing is claimed about it until the document is read.</Empty>
        <DocsLink />
      </Section>
    );
  }
  if (view.state === "absent") {
    return (
      <Section id="crosscheck" title={TITLE} count="not running" note={NOTE}>
        <Empty>The API serving this page is not running the Envio HyperSync cross-check (it is off unless the operator sets an Envio API token), so nothing on this page has been cross-checked against HyperSync.</Empty>
        <DocsLink />
      </Section>
    );
  }
  const none = "none yet";
  return (
    <Section id="crosscheck" title={TITLE} count={<Pill tone={view.state === "match" ? "good" : "bad"}>{view.state}</Pill>} note={NOTE}>
      {view.state === "match" && <p role="status" className="text-sm">Every indexed row in the range was found in HyperSync with the same fields, and HyperSync returned no row the indexer lacks.</p>}
      {view.state === "mismatch" && (
        <p role="alert" className="rounded-[10px] border border-bad bg-bad-wash px-3.5 py-3 text-sm">
          The two sources differ over this range. This is a difference to investigate, not a conclusion about which side is wrong, and nothing is corrected automatically.
        </p>
      )}
      {view.state === "unverified" && (
        <p role="note" className="rounded-[10px] border border-warn bg-warn-wash px-3.5 py-3 text-sm">
          Unverified: {view.reason} This is not a pass, and it says nothing about whether the indexer is right.
        </p>
      )}
      <dl aria-label="Cross-check result" className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-4">
        <Cell label="Block range">{view.range ? `${view.range.from} to ${view.range.to}` : none}</Cell>
        <Cell label="Rows in the indexer">{view.counts ? view.counts.indexer : none}</Cell>
        <Cell label="Rows in HyperSync">{view.counts ? view.counts.hypersync : none}</Cell>
        <Cell label="Matched">{view.matched ?? none}</Cell>
        <Cell label="Missing in HyperSync">{view.missing ? view.missing.inHyperSync : none}</Cell>
        <Cell label="Missing in the indexer">{view.missing ? view.missing.inIndexer : none}</Cell>
        <Cell label="Field mismatches">{view.fieldMismatches ?? none}</Cell>
        <Cell label="HyperSync height">{view.height ?? "not read"}</Cell>
      </dl>
      <p className="text-sm text-muted">
        {view.checkedAt === null ? "No comparison has finished yet." : <>Checked <time dateTime={new Date(view.checkedAt).toISOString()}>{utc(view.checkedAt)}</time> ({ago(view.checkedAt, now)}).</>}
      </p>
      <DocsLink />
    </Section>
  );
}
