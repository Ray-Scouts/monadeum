"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardHead, Pill } from "@/components/ui";
import { isApiError } from "@/data/api/client";
import {
  explainFunding,
  FUNDING_COPY,
  fundingAmount,
  fundingBlocked,
  fundingErrorText,
  fundingOperation,
  fundingStep,
  txUrl,
  usdc,
  type FundingStep,
} from "@/data/api/funding";
import { signWith } from "@/data/api/signing";
import type { ApiAgent, FundingInfo } from "@/data/api/types";
import { useAuth } from "./auth";
import { SignatureRequestView } from "./OperationSigner";

const POLL_MS = 2000;

type InfoRead = { info: FundingInfo } | { unavailable: string } | null;

const TONE: Record<FundingStep["state"], "good" | "warn" | "bad" | "off"> = {
  idle: "off",
  preparing: "off",
  signing: "warn",
  pending: "warn",
  confirmed: "good",
  failed: "bad",
};

/**
 * "Fund this agent": the owner moves USDC from the owner wallet to the agent's account through one signed EIP-3009
 * authorization, which the platform's relayer submits, paying the gas. The plain-language summary comes first and the
 * raw typed data is expandable, as for every owner signature.
 */
export function FundAgent({ agent, onChanged }: { agent: ApiAgent; onChanged(): void }) {
  const auth = useAuth();
  const session = auth.state.status === "signed-in" ? auth.state.session : null;
  const [read, setRead] = useState<InfoRead>(null);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<FundingStep>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(() => {
    if (!session) return;
    session
      .fundingInfo(agent.id)
      .then((info) => setRead({ info }))
      .catch((e: unknown) =>
        setRead({ unavailable: isApiError(e, "funding-unavailable") ? "Funding is not available on this server: it has no relayer configured." : fundingErrorText(e) }),
      );
  }, [session, agent.id]);

  useEffect(load, [load]);

  // Follows a submitted transfer until the API reports it confirmed or failed.
  const pendingNonce = step.state === "pending" ? step.funding.nonce : null;
  useEffect(() => {
    if (!session || !pendingNonce) return;
    let cancelled = false;
    const timer = setInterval(() => {
      session
        .fundingStatus(agent.id, pendingNonce)
        .then(({ funding }) => {
          if (cancelled) return;
          const next = fundingStep(funding);
          setStep(next);
          if (next.state !== "pending") {
            load();
            onChangedRef.current();
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session, agent.id, pendingNonce, load]);

  const info = read && "info" in read ? read.info : null;
  const decimals = info?.decimals ?? 6;
  const blocked = info ? fundingBlocked(info) : null;

  async function prepare() {
    if (!session || !info) return;
    setError(null);
    const checked = fundingAmount(amount, info);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setStep({ state: "preparing" });
    try {
      setStep({ state: "signing", prepared: await session.prepareFunding(agent.id, checked.value) });
    } catch (e) {
      setStep({ state: "idle" });
      setError(fundingErrorText(e));
    }
  }

  async function sign() {
    if (!session || !info || step.state !== "signing") return;
    setBusy(true);
    setError(null);
    try {
      const { provider, address } = await auth.ownerWallet();
      const signature = await signWith(provider, address, fundingOperation(step.prepared, info.owner));
      const { funding } = await session.submitFunding(agent.id, step.prepared.funding.nonce, signature);
      const next = fundingStep(funding, decimals);
      setStep(next);
      if (next.state !== "pending") {
        load();
        onChangedRef.current();
      }
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      setError(code === 4001 ? "The request was declined in your wallet. Nothing was signed." : fundingErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead title="Fund this agent">
        <Pill tone="accent">Gas paid by the platform</Pill>
      </CardHead>
      <p className="text-[13px] text-muted">{FUNDING_COPY.what}</p>
      <p className="mt-1.5 text-[13px] text-muted">{FUNDING_COPY.rule}</p>

      {!read && (
        <p role="status" className="mt-3 text-sm text-muted">
          Reading your balance…
        </p>
      )}
      {read && "unavailable" in read && <p className="mt-3 text-sm text-muted">{read.unavailable}</p>}

      {info && (
        <div className="mt-3 flex flex-col gap-3 text-sm">
          <p>
            Your owner wallet holds <b>{info.ownerBalance === null ? "an unknown amount of" : usdc(info.ownerBalance, decimals)}</b>
            {info.ownerBalance === null ? " USDC (the chain could not be read)" : ""}, read from chain. Up to {usdc(info.maxPerTransfer, decimals)} per transfer;{" "}
            {info.daily.remaining} of {info.daily.limit} relayed transfers left in the last 24 hours.
          </p>
          {blocked && <p className="rounded-xl border border-warn bg-warn-wash px-4 py-3 text-warn">{blocked}</p>}
          {!blocked && (step.state === "idle" || step.state === "preparing" || step.state === "confirmed" || step.state === "failed") && (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void prepare();
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Amount (USDC)</span>
                <input
                  className="w-40 rounded-lg border border-line bg-surface-2 px-3 py-2"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="5.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-describedby="fund-error"
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={step.state === "preparing"}>
                {step.state === "preparing" ? "Preparing…" : "Review the transfer"}
              </button>
            </form>
          )}
        </div>
      )}

      {step.state === "signing" && info && (
        <div className="mt-3 flex flex-col gap-2">
          <SignatureRequestView
            operation={fundingOperation(step.prepared, info.owner)}
            explanation={explainFunding(step.prepared, info.owner)}
            busy={busy}
            error={null}
            onSign={() => void sign()}
          />
          <button type="button" className="btn btn-ghost self-start" disabled={busy} onClick={() => setStep({ state: "idle" })}>
            Cancel
          </button>
        </div>
      )}

      {(step.state === "pending" || step.state === "confirmed" || step.state === "failed") && (
        <div role="status" aria-live="polite" className="mt-3 flex flex-col gap-1.5 text-sm">
          <span className="flex items-start gap-2">
            <Pill tone={TONE[step.state]}>{step.state}</Pill>
            <span>{step.message}</span>
          </span>
          {step.funding?.txHash && (
            <a className="font-mono text-xs text-accent-hi underline break-all" href={txUrl(step.funding.txHash)} target="_blank" rel="noreferrer noopener">
              Transaction {step.funding.txHash} on the Monad testnet explorer
            </a>
          )}
        </div>
      )}

      <p id="fund-error" role="alert" className="mt-2 text-sm text-bad empty:hidden">
        {error}
      </p>
    </Card>
  );
}
