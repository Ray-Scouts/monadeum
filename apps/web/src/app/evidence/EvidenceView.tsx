"use client";

import { useEffect, useState } from "react";
import { WEB_CONFIG } from "@/data/config";
import { useEvidence } from "@/data/evidence/useEvidence";
import { EvidenceReport } from "./EvidenceReport";

/** The live page: reads the document and re-checks it against the chain in the browser. No session is used or needed. */
export function EvidenceView() {
  const state = useEvidence(WEB_CONFIG.apiUrl);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  return <EvidenceReport evidence={state.evidence} apiConfigured={WEB_CONFIG.apiUrl !== null} error={state.error} results={state.results} busy={state.busy} checkedAt={state.checkedAt} now={now} onRefresh={state.refresh} />;
}
