"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { explain, rawPayload, signWith, type Explanation } from "@/data/api/signing";
import type { Operation } from "@/data/api/types";
import { useAuth } from "./auth";
import { errorText } from "./ErrorNote";

export interface SignatureRequestViewProps {
  operation: Operation;
  name?: (agentId: string) => string;
  busy: boolean;
  error: string | null;
  onSign(): void;
  /** Replaces the generic explanation, for a request whose meaning the caller can state more precisely. */
  explanation?: Explanation;
}

/**
 * What the owner is about to sign: a plain-language summary first, then the exact payload in an expandable section.
 * Signing happens in the wallet's own UI; this page receives only the signature.
 */
export function SignatureRequestView({ operation, name, busy, error, onSign, explanation }: SignatureRequestViewProps) {
  const request = operation.signatureRequest;
  const e = explanation ?? explain(operation, name);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-4 text-sm">
      <span className="eyebrow">Your signature is needed</span>
      <p className="font-medium">{e.summary}</p>
      <ul className="m-0 list-disc pl-5 text-muted">
        {e.details.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      {e.caution && (
        <p className="flex items-start gap-2 rounded-lg bg-warn-wash px-3 py-2 text-warn">
          <Icon name="alert" className="mt-0.5 size-4 flex-none" />
          {e.caution}
        </p>
      )}
      {request && (
        <details>
          <summary className="cursor-pointer text-muted">Raw data your wallet will sign ({request.kind === "typed-data" ? "EIP-712 typed data" : "EIP-191 message"})</summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface p-3 font-mono text-xs break-all whitespace-pre-wrap">{rawPayload(request)}</pre>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={busy || !request} onClick={onSign}>
          <Icon name="key" />
          {busy ? "Waiting for your wallet…" : "Review and sign in your wallet"}
        </button>
        <span className="text-xs text-muted">Only the signature is sent to the API. No key leaves your wallet.</span>
      </div>
      <p role="alert" className="text-bad empty:hidden">
        {error}
      </p>
    </div>
  );
}

/**
 * Drives one owner-signed operation to its end: each signature request is shown and signed, the signature is posted,
 * and a running operation is followed with `GET /operations/:id?wait=true`. `onChange` receives every new state.
 */
export function OperationSigner({ operation, name, onChange }: { operation: Operation; name?: (agentId: string) => string; onChange(op: Operation): void }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const session = auth.state.status === "signed-in" ? auth.state.session : null;

  // Follows a running operation until it asks for a signature or ends.
  useEffect(() => {
    if (!session || operation.status !== "running") return;
    let cancelled = false;
    session
      .operation(operation.id, true)
      .then(({ operation: next }) => !cancelled && onChangeRef.current(next))
      .catch((e: unknown) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [session, operation]);

  if (operation.status === "running") {
    return (
      <p role="status" className="text-sm text-muted">
        Waiting for the network to include the operation…
      </p>
    );
  }
  if (operation.status !== "awaiting-signature") return null;

  async function sign() {
    if (!session || !operation.signatureRequest) return;
    setBusy(true);
    setError(null);
    try {
      const { provider, address } = await auth.ownerWallet();
      const signature = await signWith(provider, address, operation);
      const { operation: next } = await session.submitSignature(operation.id, operation.signatureRequest.id, signature);
      onChangeRef.current(next);
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      setError(code === 4001 ? "The request was declined in your wallet. Nothing was signed." : errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return <SignatureRequestView operation={operation} name={name} busy={busy} error={error} onSign={() => void sign()} />;
}
