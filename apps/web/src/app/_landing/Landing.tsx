import Link from "next/link";
import { REALLOCATION_CAP, SLOT_CEILING } from "@monadeum/reallocation/constants";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { Icon, Logo } from "@/components/Icon";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Pill } from "@/components/ui";
import { CountUp } from "./CountUp";
import { GenomeCard } from "./GenomeCard";
import { Petri } from "./Petri";
import { ReallocationDemo } from "./ReallocationDemo";
import { RotatingWord } from "./RotatingWord";
import { ShrinkageChart } from "./ShrinkageChart";
import { TickLoop } from "./TickLoop";
import { REALLOC, money, percent } from "./numbers";
import s from "./landing.module.css";

const NICHES = ["var(--sky)", "var(--mint)", "var(--accent)", "var(--berry)", "var(--sun)"];

const TICKER: readonly [color: string, title: string, detail: string][] = [
  ["var(--sun)", "Nimbus·3c1d sent capital to Kestrel·a1f0", `${money(REALLOC.moved)}, same owner, total unchanged`],
  ["var(--bad)", "Proposal rejected", "Orca·19bd exceeds its cap"],
  ["var(--berry)", "Vela·4e02 bought data from Nansen", "$0.03"],
  ["var(--mint)", "Lumen·77c2 ranked for the first time", "it has an adjusted fitness"],
  ["var(--faint)", "Ferro·c1a9 retired", "balance kept"],
  ["var(--sky)", "Quill·0b7e skipped DeFiLlama", "not worth its price"],
  ["var(--accent)", "Circuit breaker checked", "31% of threshold"],
];

const LAYERS = [
  { color: "var(--sky)", title: "A proposal, not an order", body: "The model suggests. It never signs and never sets limits." },
  { color: "var(--mint)", title: "Policy engine", body: "Session budget, allowed contracts and x402 spend, checked before anything is sent." },
  { color: "var(--accent)", title: "On-chain caps", body: "Per transaction and per day. The account rejects anything over, no matter who approved it." },
  { color: "var(--sun)", title: "Population brake", body: "If capital at risk or the capital moved by reallocation spikes, ticks and reallocation pause until a person reviews it." },
];

const STACK = [
  { name: "Monad", body: "Execution and settlement network", color: "text-accent-hi" },
  { name: "ERC-4337", body: "One isolated smart account per agent", color: "text-sky" },
  { name: "x402", body: "Pay-per-request information, agent to service", color: "text-berry" },
  { name: "Kuru", body: "Trade execution", color: "text-mint" },
  { name: "Nansen", body: "On-chain intelligence via x402", color: "text-sun" },
  { name: "DeFiLlama", body: "Market data via x402", color: "text-fg" },
];

const FAQ = [
  { q: "Do I need to know about blockchain?", a: "No. You sign in with Google, email or a passkey and we create a wallet for you. An external wallet is optional, for advanced users." },
  { q: "Can an agent drain my account?", a: "No. Each agent lives in its own smart account with on-chain per-transaction and daily caps, and can only call allowlisted contracts. You can revoke it at any time." },
  { q: "What happens to a retired agent's money?", a: "It stays in its account and you can recover it. Retiring force-liquidates nothing, and its history is kept." },
  { q: "Can capital move between my agents?", a: "Only if you sign a reallocation policy, and only between the agents it names. An agent can end up below what you put into it, while your total across your agents stays the same. Capital never moves to another owner's agents. You can revoke the policy at any time." },
  { q: "Who pays for the information it buys?", a: "The agent itself, from its own capital and within its budget. That spend counts as a cost in its fitness, so overbuying hurts it." },
  { q: "When does it reach mainnet?", a: "After the security and testnet phases are complete. Even then it is opt-in per account and per agent." },
];

function SecHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div>
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {children && <p className={s.sub}>{children}</p>}
    </div>
  );
}

export function Landing() {
  return (
    <div className={s.page}>
      <header className={s.nav}>
        <Link href="/" aria-label="Monadeum" className="tap inline-flex items-center gap-2.5 rounded-lg font-display text-lg font-bold">
          <Logo className="size-[28px] flex-none" />
          <span className={s.wordmark}>Monadeum</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1.5">
          <a className={s.navtxt} href="#how">How it works</a>
          <a className={s.navtxt} href="#genome">Genome</a>
          <a className={s.navtxt} href="#security">Security</a>
          <a className={s.navtxt} href="#faq">FAQ</a>
          <details className={s.menu}>
            <summary aria-label="Page sections">
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </summary>
            <div className={s.menuList}>
              <a href="#how">How it works</a>
              <a href="#genome">Genome</a>
              <a href="#security">Security</a>
              <a href="#faq">FAQ</a>
            </div>
          </details>
          <ThemeToggle />
          <Link href="/population" className="btn btn-ink whitespace-nowrap px-4">Open app</Link>
        </nav>
      </header>

      <main>
        <section className={s.hero}>
          <div className="min-w-0">
            <span className={s.liveBadge}><span className={s.pulse} />Monad testnet · preview</span>
            <h1>Agents that earn their <RotatingWord />.</h1>
            <p className="mt-[22px] max-w-[52ch] text-[clamp(16px,1.6vw,19px)] text-muted">
              Create an AI agent with its own capital. It buys information when it pays off and trades inside the limits you set. If it keeps failing, it retires. Each agent runs on its own capital: reallocation between agents is off by default.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/create" className="btn btn-ink btn-lg">Create my first agent <Icon name="arrow" /></Link>
              <Link href="/capital-flow" className="btn btn-lg">See capital flow</Link>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-[18px] gap-y-2 p-0 text-[13px] text-muted">
              {["Sign in with Google or email", "No MON needed for gas", "On-chain limits"].map((t) => (
                <li key={t} className="inline-flex list-none items-center gap-1.5"><span className="text-good"><Icon name="check" /></span>{t}</li>
              ))}
            </ul>
          </div>
          <div className={s.petriStage}>
            <div className={s.petri} role="img" aria-label="Animation: a population of agents where capital shifts toward the fitter agents of the same owner and the weakest retire. Move your cursor to disturb it.">
              <Petri n={38} round />
            </div>
            <div className={`${s.floatCard} ${s.fc1}`} aria-hidden="true">
              <span className="eyebrow">Reallocation · sample</span>
              <b>Nimbus·3c1d → Kestrel·a1f0</b>
              <span className="text-muted">{money(REALLOC.moved)} between agents of one owner</span>
            </div>
            <div className={`${s.floatCard} ${s.fc2}`} aria-hidden="true">
              <span className="eyebrow">Policy · sample</span>
              <b><span className={s.dotc} style={{ background: "var(--bad)" }} />Rejected</b>
              <span className="text-muted">Exceeds per-transaction cap</span>
            </div>
            <div className={s.petriLegend}>
              <span>{NICHES.map((c) => <i key={c} style={{ background: c }} />)}5 risk niches</span>
              <span><i style={{ background: "transparent", border: "1.5px solid var(--faint)" }} />Retired</span>
            </div>
          </div>
        </section>

        <div className="flex items-stretch border-y border-line-soft bg-surface" role="region" aria-label="Sample recent activity">
          <span className="z-[1] flex flex-none items-center border-r border-line-soft px-3 font-mono text-xs tracking-[0.12em] text-warn uppercase">Sample</span>
          <div className={`${s.ticker} min-w-0 flex-1`}>
            <div className={s.tickerTrack}>
              {[0, 1].map((copy) =>
                TICKER.map(([color, title, detail]) => (
                  <span key={`${copy}-${title}`} aria-hidden={copy === 1 ? true : undefined}>
                    <span className={s.dotc} style={{ background: color }} />
                    <b>{title}</b>
                    {detail}
                  </span>
                )),
              )}
            </div>
          </div>
        </div>

        <section className={`${s.section} ${s.stats}`} aria-label="Protocol rules">
          <div className={s.stat}><CountUp to={PROTOCOL.testnetPopulationCap} className={s.statN} /><span>agents max on testnet. At the cap, creating an agent is refused.</span></div>
          <div className={s.stat}><CountUp to={Math.round(REALLOCATION_CAP * 100)} suffix="%" className={s.statN} /><span>of an agent&apos;s capital, at most, moves at one evaluation, and only under a policy its owner signed.</span></div>
          <div className={s.stat}><CountUp to={SLOT_CEILING} suffix="x" className={s.statN} /><span>its principal: the most reallocation can raise one agent to.</span></div>
          <div className={s.stat}><CountUp to={0} prefix="$" className={s.statN} /><span>of capital created by reallocation. It only moves between one owner&apos;s agents.</span></div>
        </section>

        <section className={s.section} id="how">
          <SecHead eyebrow="Every tick" title="The AI proposes. The policy engine decides.">
            No language model has the final say over your money. Every action goes through rules the agent cannot change.
          </SecHead>
          <TickLoop />
        </section>

        <section className={s.section} id="genome">
          <GenomeCard
            footnote={<p className={s.fine}>Gene ranges are the protocol&apos;s bounds; the values are a sample.</p>}
          >
            <SecHead eyebrow="Anatomy of an agent" title="A genome you choose. Limits you cannot move.">
              You pick its pairs, its risk, how often it ticks and what it may spend on information. The genome is fixed for the agent&apos;s life: for a different strategy, you create another agent. Nothing copies or changes it, and protocol caps bound every field.
            </SecHead>
          </GenomeCard>
        </section>

        <section className={s.section}>
          <ReallocationDemo>
            <SecHead eyebrow="Reallocation without magic" title="Capital moves between your own agents. Your total does not.">
              Off by default. Under a policy you sign, each evaluation moves up to {percent(REALLOCATION_CAP)} of your lowest-ranked agent&apos;s capital to your highest-ranked one, which can hold at most {SLOT_CEILING} times its principal. An agent can end up below its own principal; your total across your agents stays the same. Each move is one atomic on-chain transfer.
            </SecHead>
          </ReallocationDemo>
        </section>

        <section className={s.section}>
          <ShrinkageChart>
            <SecHead eyebrow="Fitness that does not reward luck" title="Three lucky trades do not make a genius.">
              Fitness is risk-adjusted and blended with the population median based on how much evidence the agent has. Move the slider to see how trust changes.
            </SecHead>
          </ShrinkageChart>
        </section>

        <section className={s.section} id="security">
          <SecHead eyebrow="Layered security" title="If one layer fails, the next one still holds.">
            The most important caps live on-chain. Even if the application is compromised, the smart account rejects anything over the limit.
          </SecHead>
          <div className={s.layers}>
            <div className={s.layerStack} aria-hidden="true">
              <span className={s.drop} />
              {LAYERS.map((l, k) => (
                <div key={l.title} className={s.ls} style={{ borderTop: `3px solid ${l.color}` }}>
                  {["AI proposal", "Policy engine", "On-chain smart account", "Population circuit breaker"][k]}
                </div>
              ))}
            </div>
            <div className="grid gap-[18px]">
              {LAYERS.map((l) => (
                <div key={l.title}>
                  <h3 className="flex items-center gap-2.5 text-lg font-bold"><span className={s.dotc} style={{ background: l.color }} />{l.title}</h3>
                  <p className="mt-1 pl-[18px] text-sm text-muted">{l.body}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-9 grid gap-3.5 md:grid-cols-3">
            {[
              { tone: "accent" as const, label: "Simulation", title: "No real money", body: "Deterministic markets with a fixed seed. Ideal for understanding a genome." },
              { tone: "warn" as const, label: "Testnet", title: "Real test assets", body: "Wallets, x402, reallocation and accounting end to end." },
              { tone: "berry" as const, label: "Mainnet", title: "Double opt-in", body: "Enabled for your account and for each agent. Never by default." },
            ].map((m) => (
              <div key={m.label} className="flex flex-col items-start gap-2.5 rounded-card border border-line-soft bg-surface p-[22px]">
                <Pill tone={m.tone}>{m.label}</Pill>
                <h3 className="text-[22px]">{m.title}</h3>
                <p className="text-sm text-muted">{m.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={s.section}>
          <SecHead eyebrow="Built on" title="Open pieces, chosen with evidence.">
            Documented choices, still being validated on testnet. None is final.
          </SecHead>
          <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STACK.map((t) => (
              <div key={t.name} className={s.st}>
                <b className={t.color}>{t.name}</b>
                <span>{t.body}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={s.section}>
          <div className="mt-2 grid items-start gap-7 rounded-card border border-dashed border-line p-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div>
              <span className="eyebrow">What we do not know yet</span>
              <h2 className="!text-[28px]">An experiment, not a promise.</h2>
            </div>
            <div className="grid gap-3 text-muted">
              <p>Monadeum asks whether agents do better when capital and information are scarce. An earlier design let profitable agents reproduce. In simulation it did not beat a static population in any setting tried, so it was dropped.</p>
              <p>The adopted design keeps each owner&apos;s set of agents fixed, retires agents that keep failing and, under a policy the owner signs, shifts that owner&apos;s capital toward their better-ranked agents. In simulation that beat a static population, but only because the simulated strategies were given an edge to find. A pre-registered study on on-chain market data then found no measurable edge for the current strategy, so reallocation stays off and each agent runs on its own capital. We publish the rules, the limits and the results. We do not promise returns.</p>
            </div>
          </div>
        </section>

        <section className={s.section} id="faq">
          <SecHead eyebrow="Frequently asked questions" title="Before you create your agent" />
          <div className={`${s.faq} mt-6 grid max-w-[820px] gap-2.5`}>
            {FAQ.map((f, k) => (
              <details key={f.q} open={k === 0}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={s.section}>
          <div className={s.finalCta}>
            <Petri n={46} round={false} lineColor="--ink-btn-fg" />
            <div className="relative grid justify-items-center gap-3.5 px-5 py-12">
              <h2>Your first agent is four steps away.</h2>
              <p className="opacity-70">Testnet, no MON, no real risk.</p>
              <Link href="/create" className={`btn btn-lg ${s.ctaInv}`}>Create my first agent <Icon name="arrow" /></Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="flex flex-wrap justify-between gap-3 border-t border-line-soft px-[clamp(16px,4vw,48px)] py-6 text-[13px] text-faint">
        <span>Monadeum · built on Monad</span>
        <span>Figures on this page are illustrative samples.</span>
      </footer>
    </div>
  );
}
