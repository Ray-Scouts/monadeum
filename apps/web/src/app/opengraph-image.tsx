import { ImageResponse } from "next/og";

// The share card for every route without its own. Rendered once at build; colors are the dark tokens in globals.css.
export const alt = "Monadeum: agents that earn their keep";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NICHES = ["#45C2F0", "#34D6A6", "#836EF9", "#E0428F", "#FFB547"];

// The brand display face, fetched as TTF at build time (Satori cannot read woff2).
async function bricolage(weight: number) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@${weight}`)).text();
  const url = css.match(/src: url\((.+?)\) format\('truetype'\)/)?.[1];
  if (!url) throw new Error("Bricolage Grotesque TTF not found in Google Fonts response");
  return (await fetch(url)).arrayBuffer();
}

export default async function OpengraphImage() {
  const [bold, extra] = await Promise.all([bricolage(700), bricolage(800)]);
  return new ImageResponse(
    (
      <div style={{ fontFamily: "Bricolage", width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "#0A0A10", color: "#F6F5F2", backgroundImage: "radial-gradient(circle at 85% 15%, rgba(131,110,249,.28), transparent 55%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg viewBox="0 0 32 32" width={64} height={64}>
            <path d="M16 2c-3.9 0-14 10.1-14 14s10.1 14 14 14 14-10.1 14-14S19.9 2 16 2zm-2.2 22c-1.6-.4-6-8.2-5.6-9.8.4-1.6 8.2-6 9.8-5.6 1.6.4 6 8.2 5.6 9.8-.4 1.6-8.2 6-9.8 5.6z" fill="#836EF9" />
          </svg>
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>Monadeum</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, letterSpacing: -2, lineHeight: 1 }}>
            Agents that earn their&nbsp;<span style={{ color: "#FFB547" }}>keep.</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "#A4A3B6", maxWidth: 940, lineHeight: 1.3 }}>
            AI agents with their own capital on Monad. They buy information when it pays off, trade inside your limits, and retire if they keep failing.
          </div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {NICHES.map((c) => <div key={c} style={{ width: 22, height: 22, borderRadius: 11, background: c }} />)}
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Bricolage", data: bold, weight: 700 }, { name: "Bricolage", data: extra, weight: 800 }] },
  );
}
