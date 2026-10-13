"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchEvidence } from "./client";
import { DEPLOYMENT } from "./deployments";
import type { Evidence, Verification } from "./types";
import { deploymentTasks, evidenceTasks, runChecks, viemReader, type ChainReader } from "./verify";

export interface EvidenceState {
  evidence: Evidence | null;
  /** Why the document could not be read, or null. A failure leaves `evidence` null: the page then shows no record. */
  error: string | null;
  results: ReadonlyMap<string, Verification>;
  /** True while the document or its checks are in flight. */
  busy: boolean;
  /** When the last full pass (document and every check) finished, or null. */
  checkedAt: number | null;
  refresh(): void;
}

/**
 * Loads the document (when an API is configured), then re-checks it and the deployment record against the chain. The
 * checks of the deployment record run whether or not the API answered, because they need only the RPC. Each refresh
 * starts over: results of the previous pass are dropped, so nothing stays green on the strength of an earlier read.
 */
export function useEvidence(apiUrl: string | null, makeReader: () => ChainReader = viemReader): EvidenceState {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ReadonlyMap<string, Verification>>(new Map());
  const [busy, setBusy] = useState(true);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [pass, setPass] = useState(0);
  const makeRef = useRef(makeReader);
  makeRef.current = makeReader;

  useEffect(() => {
    let stopped = false;
    setBusy(true);
    setResults(new Map());
    const report = (key: string, v: Verification) => {
      if (!stopped) setResults((prev) => new Map(prev).set(key, v));
    };
    (async () => {
      const reader = makeRef.current();
      let doc: Evidence | null = null;
      if (apiUrl) {
        try {
          doc = await fetchEvidence(apiUrl);
          if (!stopped) (setEvidence(doc), setError(null));
        } catch (e) {
          if (!stopped) (setEvidence(null), setError(e instanceof Error ? e.message : "The evidence endpoint could not be reached."));
        }
      } else if (!stopped) (setEvidence(null), setError(null));
      if (stopped) return;
      const tasks = [...deploymentTasks(reader, DEPLOYMENT), ...(doc ? evidenceTasks(reader, DEPLOYMENT, doc) : [])];
      await runChecks(reader, tasks, report, () => stopped);
      if (!stopped) (setBusy(false), setCheckedAt(Date.now()));
    })();
    return () => {
      stopped = true;
    };
  }, [apiUrl, pass]);

  const refresh = useCallback(() => setPass((p) => p + 1), []);
  return { evidence, error, results, busy, checkedAt, refresh };
}
