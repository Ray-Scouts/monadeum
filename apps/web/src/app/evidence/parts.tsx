"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { addressLink, blockLink, middle, txLink } from "@/data/evidence/explorer";
import type { Verification } from "@/data/evidence/types";

// Building blocks of the evidence page. Touch targets are at least 44 px (size-11, min-h-11). Long values are cut in the
// middle for display only; the full value is in the link's accessible name and in `title`, and the copy button copies it.

type CopyState = "idle" | "copied" | "failed";

export function CopyValue({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<CopyState>("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2400);
    return () => clearTimeout(t);
  }, [state]);
  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        className={`inline-grid size-11 flex-none place-items-center rounded-lg ${state === "copied" ? "text-good" : state === "failed" ? "text-bad" : "text-muted hover:text-fg"}`}
      >
        <Icon name={state === "copied" ? "check" : state === "failed" ? "x" : "copy"} className="size-4" />
      </button>
      <span role="status" className="sr-only">
        {state === "copied" ? `${label} copied` : state === "failed" ? "Could not copy. Select the value and copy it manually." : ""}
      </span>
    </>
  );
}

type Kind = "tx" | "address" | "block";
const HREF: Record<Kind, (v: string) => string> = { tx: txLink, address: addressLink, block: blockLink };
const NOUN: Record<Kind, string> = { tx: "transaction", address: "address", block: "block" };

/** A hash or address: cut in the middle, linked to the Monad testnet explorer, with a copy button. */
export function Hash({ value, kind }: { value: string; kind: Kind }) {
  const noun = NOUN[kind];
  return (
    <span className="inline-flex max-w-full min-w-0 items-center">
      <a
        href={HREF[kind](value)}
        target="_blank"
        rel="noopener noreferrer"
        title={value}
        aria-label={`${noun} ${value}, opens in the block explorer`}
        className="inline-flex min-h-11 min-w-0 items-center font-mono text-[13px] text-accent-hi underline decoration-line underline-offset-4 hover:decoration-accent-hi"
      >
        {kind === "block" ? value : middle(value)}
      </a>
      {kind !== "block" && <CopyValue value={value} label={noun} />}
    </span>
  );
}

/** Green only when verified. Every other state says what it is, in words, and keeps the reason readable. */
export function VerifyBadge({ v }: { v: Verification | undefined }) {
  const state = v ?? { state: "checking" as const };
  if (state.state === "verified") {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <Pill tone="good">verified</Pill>
        <span className="text-xs break-words text-muted">{state.detail}</span>
      </span>
    );
  }
  if (state.state === "unverified") {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <Pill tone="bad">unverified</Pill>
        <span className="text-xs break-words text-muted">{state.reason}</span>
      </span>
    );
  }
  return <Pill tone="off">checking</Pill>;
}

/** Combines checks: verified only when all are; any failure is unverified; otherwise still checking. */
export function allOf(checks: (Verification | undefined)[]): Verification {
  const failed = checks.find((c) => c?.state === "unverified");
  if (failed && failed.state === "unverified") return failed;
  if (checks.every((c) => c?.state === "verified")) return { state: "verified", detail: `${checks.length} checks match the chain` };
  return { state: "checking" };
}

export function Section({ id, title, count, children, note }: { id: string; title: string; count?: ReactNode; children: ReactNode; note?: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="flex min-w-0 flex-col gap-3 rounded-card border border-line-soft bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-h`} className="text-xl font-bold">
          {title}
        </h2>
        {count !== undefined && <span className="font-mono text-sm text-muted tabular">{count}</span>}
      </div>
      {note && <p className="max-w-[72ch] text-sm text-muted">{note}</p>}
      {children}
    </section>
  );
}

/** An honest empty state: the category stays visible with its zero and the reason. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="rounded-[10px] border border-dashed border-line bg-surface-2 px-3.5 py-3 text-sm text-muted">
      {children}
    </p>
  );
}

export interface Column<T> {
  id: string;
  header: string;
  cell(row: T): ReactNode;
}

/**
 * A semantic table from 768 px, stacked cards below it, from the same columns. Both are in the markup; CSS shows one,
 * so a screen reader reads only the visible one.
 */
export function Records<T>({ caption, rows, columns, rowKey }: { caption: string; rows: readonly T[]; columns: readonly Column<T>[]; rowKey(row: T, index: number): string }) {
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line">
              {columns.map((c) => (
                <th key={c.id} scope="col" className="px-2 py-2 align-bottom text-xs font-medium tracking-wide text-muted uppercase">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={rowKey(row, i)} className="border-b border-line-soft align-top last:border-0">
                {columns.map((c) => (
                  <td key={c.id} className="min-w-0 px-2 py-1.5 break-words">
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={caption} className="grid gap-3 md:hidden">
        {rows.map((row, i) => (
          <li key={rowKey(row, i)} className="min-w-0 rounded-[14px] border border-line-soft bg-surface-2 p-3.5">
            <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
              {columns.map((c) => (
                <div key={c.id} className="contents">
                  <dt className="text-xs text-muted">{c.header}</dt>
                  <dd className="min-w-0 break-words">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
