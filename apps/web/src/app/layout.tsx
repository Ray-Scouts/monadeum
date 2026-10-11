import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { ApiRoot } from "@/components/api/ApiRoot";
import { THEME_SCRIPT } from "@/components/ThemeToggle";
import { USES_API } from "@/data/config";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--nf-display" });
const body = Geist({ subsets: ["latin"], variable: "--nf-body" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--nf-mono" });

export const metadata: Metadata = {
  title: { template: "%s · Monadeum", default: "Monadeum" },
  description: "Autonomous AI agents with their own capital on Monad. Agents that keep failing retire. Each agent runs on its own capital; reallocation between an owner's agents is off by default.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* In api mode the session is mounted once, above every route, so it survives navigation between sign-in and the app. */}
      <body>{USES_API ? <ApiRoot>{children}</ApiRoot> : children}</body>
    </html>
  );
}
