"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Client only: the credential (Privy's access token, or the API's HttpOnly cookie) exists only in the browser, and
// loading Privy here keeps it out of the sample build's runtime.
const Providers = dynamic(() => import("./Providers"), {
  ssr: false,
  loading: () => (
    <p role="status" className="p-8 text-muted">
      Loading…
    </p>
  ),
});

export function ApiRoot({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
