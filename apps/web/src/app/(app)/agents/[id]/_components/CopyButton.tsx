"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

type CopyState = "idle" | "copied" | "failed";

/** Copies a value to the clipboard and reports the outcome, including a rejected or missing clipboard. */
export function CopyButton({ value, label }: { value: string; label: string }) {
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
        aria-label={label}
        title={label}
        className={`inline-flex size-11 flex-none items-center justify-center rounded-md ${state === "copied" ? "text-good" : state === "failed" ? "text-bad" : "text-muted hover:text-fg"}`}
      >
        <Icon name={state === "copied" ? "check" : state === "failed" ? "x" : "copy"} className="size-4" />
      </button>
      <span role="status" className="sr-only">
        {state === "copied" ? "Address copied" : state === "failed" ? "Could not copy. Select the address and copy it manually." : ""}
      </span>
    </>
  );
}
