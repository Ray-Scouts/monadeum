"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionClient } from "@/data/api/client";
import { useSession } from "./auth";

/** How often an open screen re-reads the API, so it follows state changes without a page reload. */
export const REFRESH_MS = 15_000;

export interface ApiData<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload(): void;
}

/** Reads from the signed-in session, then again every `REFRESH_MS` and when the tab regains focus. */
export function useApiData<T>(load: (session: SessionClient) => Promise<T>, key: string): ApiData<T> {
  const session = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    loadRef
      .current(session)
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session, key, tick]);

  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS);
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  return { data, error, loading, reload };
}
