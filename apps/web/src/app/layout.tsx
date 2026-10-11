import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { THEME_SCRIPT } from "@/components/ThemeToggle";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--nf-display" });
const body = Geist({ subsets: ["latin"], variable: "--nf-body" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--nf-mono" });

const description = "Autonomous AI agents with their own capital on Monad. Agents that keep failing retire. Each agent runs on its own capital; reallocation between an owner's agents is off by default.";

export const metadata: Metadata = {
  // Share previews need absolute URLs; the build sets the public origin (https://WEB_DOMAIN in deploy).
  metadataBase: new URL(process.env.NEXT_PUBLIC_MONADEUM_WEB_URL ?? "http://localhost:3000"),
  title: { template: "%s · Monadeum", default: "Monadeum" },
  description,
  openGraph: { type: "website", siteName: "Monadeum", title: "Monadeum: agents that earn their keep", description, locale: "en_US" },
  twitter: { card: "summary_large_image", title: "Monadeum: agents that earn their keep", description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
