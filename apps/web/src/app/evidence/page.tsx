import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { EVIDENCE_DESCRIPTION } from "@/lib/site";
import { EvidenceView } from "./EvidenceView";

const title = "On-chain evidence";
const description = EVIDENCE_DESCRIPTION;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/evidence" },
  openGraph: { type: "website", siteName: "Monadeum", title: `${title} · Monadeum`, description, url: "/evidence", locale: "en_US" },
  twitter: { card: "summary_large_image", title: `${title} · Monadeum`, description },
};

/**
 * `/evidence`: public, in every mode. It sits outside the signed-in app group, so the session gate never wraps it, and
 * it uses no session credential. Static shell; the records load in the browser.
 */
export default function EvidencePage() {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-2 md:px-8">
        <Link href="/" className="inline-flex min-h-11 items-center font-display text-lg font-bold">
          Monadeum
        </Link>
        <ThemeToggle size="size-11" />
      </header>
      <main id="main" className="mx-auto w-full max-w-[1200px] px-4 pt-7 pb-20 md:px-8">
        <EvidenceView />
      </main>
    </div>
  );
}
