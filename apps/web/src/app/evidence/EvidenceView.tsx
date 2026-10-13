"use client";

import { useEffect, useRef, useState } from "react";
import { WEB_CONFIG } from "@/data/config";
import { useEvidence } from "@/data/evidence/useEvidence";
import { viemReader } from "@/data/evidence/verify";
import { EvidenceReport } from "./EvidenceReport";
import { registerEvidenceTools, type ModelContextLike } from "./webmcp";

/** The live page: reads the document and re-checks it against the chain in the browser. No session is used or needed. */
export function EvidenceView() {
  const state = useEvidence(WEB_CONFIG.apiUrl);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  // Read-only WebMCP tools (webmcp.ts), registered once and unregistered on unmount; they read the latest document through a ref.
  const evidence = useRef(state.evidence);
  evidence.current = state.evidence;
  useEffect(() => {
    const controller = new AbortController();
    registerEvidenceTools(document as unknown as { modelContext?: ModelContextLike }, controller.signal, { evidence: () => evidence.current, reader: () => viemReader() });
    return () => controller.abort();
  }, []);

  return <EvidenceReport evidence={state.evidence} apiConfigured={WEB_CONFIG.apiUrl !== null} error={state.error} results={state.results} busy={state.busy} checkedAt={state.checkedAt} now={now} onRefresh={state.refresh} />;
}
