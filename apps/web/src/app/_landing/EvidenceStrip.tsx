"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WEB_CONFIG } from "@/data/config";
import { fetchEvidence } from "@/data/evidence/client";
import { utc } from "@/data/evidence/format";
import type { Evidence } from "@/data/evidence/types";
import s from "./landing.module.css";

export interface ProofCounts {
  accounts: number;
  spends: number;
  trades: number;
  payments: number;
  generatedAt: string;
}

/** The four counts the strip shows, read from the public evidence document as it is. */
export function proofCounts(e: Evidence): ProofCounts {
  return { accounts: e.events.deployed.count, spends: e.events.spent.count, trades: e.trades.count, payments: e.payments.count, generatedAt: e.generatedAt };
}

export type ProofState = { kind: "loading" } | { kind: "unavailable"; configured: boolean } | { kind: "ready"; counts: ProofCounts };

const TIMEOUT_MS = 10_000;

/** Reads `GET /public/evidence` once. Fails closed: any error, a refused shape, a timeout, or no API in this build is "unavailable", never zeros. */
export function useProofCounts(apiUrl: string | null, load: typeof fetchEvidence = fetchEvidence): ProofState {
  const [state, setState] = useState<ProofState>(apiUrl ? { kind: "loading" } : { kind: "unavailable", configured: false });
  useEffect(() => {
    if (!apiUrl) {
      setState({ kind: "unavailable", configured: false });
      return;
    }
    let stopped = false;
    const timer = window.setTimeout(() => {
      if (!stopped) setState({ kind: "unavailable", configured: true });
    }, TIMEOUT_MS);
    load(apiUrl)
      .then((doc) => {
        if (!stopped) setState({ kind: "ready", counts: proofCounts(doc) });
      })
      .catch(() => {
        if (!stopped) setState({ kind: "unavailable", configured: true });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [apiUrl, load]);
  return state;
}

const CELLS: readonly { key: keyof Omit<ProofCounts, "generatedAt">; label: string }[] = [
  { key: "accounts", label: "agent accounts deployed" },
  { key: "spends", label: "spends recorded" },
  { key: "trades", label: "trades recorded" },
  { key: "payments", label: "x402 payments recorded" },
];

/** The presentation of the strip, separate from the fetch so it can be rendered in each state. */
export function EvidenceStripView({ state }: { state: ProofState }) {
  const kind = state.kind;
  const stamp = state.kind === "ready" ? utc(Date.parse(state.counts.generatedAt)) : null;
  return (
    <section className={s.proof} aria-label="Live on Monad testnet">
      <div className={s.proofBox}>
        <div className={s.proofHead}>
          <span className={s.proofTitle}><span className={s.proofLive} data-state={kind} />Live on Monad testnet</span>
          <span className={s.proofMeta}>
            {kind === "unavailable"
              ? (state.configured ? "The evidence endpoint could not be reached, so no counts are shown." : "No evidence endpoint is configured in this build, so no counts are shown.")
              : kind === "loading"
                ? "Reading the public evidence endpoint."
                : `Counts from our indexer as of ${stamp}.`}{" "}
            <Link href="/evidence" className="inline-flex min-h-11 items-center">Check each record on-chain</Link>
          </span>
        </div>
        {CELLS.map((c) => (
          <div key={c.key} className={s.proofCell}>
            <span className={s.proofN} data-state={kind}>{state.kind === "ready" ? state.counts[c.key].toLocaleString("en-US") : kind === "loading" ? "Checking" : "Unavailable"}</span>
            <span className={s.proofL}>{c.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Compact proof strip: the real counts of the public evidence document, or "unavailable". */
export function EvidenceStrip() {
  return <EvidenceStripView state={useProofCounts(WEB_CONFIG.apiUrl)} />;
}
