# Web frontend (`apps/web`) design

Date: 2026-10-09. Status: approved.

## Goal

Stand up the product frontend described in `ARCHITECTURE.md` section 15 as a real Next.js application, with every screen of the agreed UI prototype, backed by sample data behind a typed interface. When an API exists, only the data source changes. Login, wallets, on-chain reads, the API, and deployment are out of scope.

## Stack

- `apps/web`, package `@monadeum/web`, inside the existing Bun workspaces.
- Next.js 16 (App Router), React 19, Tailwind CSS 4, strict TypeScript.
- No viem and no Privy yet: there is nothing to read on-chain and nothing to sign. They are added with the API and login work, per `ARCHITECTURE.md` section 15.

## Routes

| Route | Screen |
|---|---|
| `/` | Landing |
| `/population` | Population overview: KPIs, agent table, niche diversity, x402 spend |
| `/lineage` | Lineage tree with selected-agent side panel |
| `/agents/[id]` | Agent detail: overview, genome, trades, x402 purchases, reproduction |
| `/events` | Evolution event feed with filters |
| `/controls` | Operating mode, limits, circuit breaker, emergency stop, bulk recovery hold |
| `/create` | Four-step agent creation |

The app routes share an `(app)` route group layout with the side rail (bottom tab bar on phones) and the top bar. Server Components are the default; only interactive parts are client components.

## Single source for protocol constants

The UI never hard-codes a protocol number. It imports:

- `@monadeum/fitness/math`: `SHRINKAGE_K`, `RISK_CUTS`, `shrinkageWeight`, `riskBand`.
- `@monadeum/reproduction/allocate`: `allocateCapital`.
- `@monadeum/recovery/decide`: `RECOVERY_WINDOW_MS`, `RECOVERY_DELAY_MS`, `RECOVERY_DISTINCT_LIMIT`.
- `monadeum-simulation/protocol`: `PROTOCOL` (`nMin`, `cooldown`, `evalEvery`, `pThreshold`, `profitThresholdFraction`, `reproductionFraction`, `maxDescendants`, `testnetPopulationCap`, `capitalFloor`, risk bounds, `pMut`, `mutBand`, `nicheShareThreshold`, `penalizedPercentile`).

Each package gains a subpath entry in `exports`. `simulation/src/protocol.ts` imports from `@monadeum/fitness/math` instead of the package root, so the browser bundle never pulls in NestJS. Behavior is unchanged.

Known gap: the five-condition reproduction eligibility rule lives in `simulation/src/reproduction.ts`, not in a library. The web data layer evaluates it with the same `PROTOCOL` constants. It moves to `libs/reproduction` when the worker needs it, and the web then imports it.

## Data layer

- `src/data/types.ts`: domain types (`Agent`, `Genome`, `AgentStatus`, `Trade`, `X402Purchase`, `EvolutionEvent`, `Limit`, `BreakerState`).
- `src/data/source.ts`: the `PopulationSource` interface and `getSource()`, the single switch point.
- `src/data/mock.ts`: a deterministic, seeded implementation. Child capital is computed with the real `allocateCapital`.
- `src/data/eligibility.ts`: the five eligibility checks, built from `PROTOCOL`.
- User actions (pause, retire, revoke, sweep, create) change client-side state only. Nothing persists. Every screen that shows sample data says so.

## UI

- Design tokens from the prototype as CSS variables mapped into Tailwind's `@theme`. Dark and light themes; the system preference is the default, the toggle persists to `localStorage`, and an inline script sets the theme before paint.
- Monad purple is one accent among five niche hues (sky, mint, purple, berry, sun) on near-neutral backgrounds.
- Fonts through `next/font`: Bricolage Grotesque (display), Geist (body), Geist Mono (data).
- Shared components in `src/components`: `StatusPill`, `Sparkline`, `Identicon`, `Kpi`, `Card`, `Segmented`, `SampleBadge`, `ThemeToggle`, `Icon`.
- All copy in English. `prefers-reduced-motion` disables animation. Visible focus states, labeled controls, and phone-width layouts are required.

## Testing and scripts

- `src/data/mock.test.ts` asserts the sample data respects the protocol invariants: a parent never ends below its principal, capital is conserved across every reproduction, no agent exceeds `maxDescendants`, and the population never exceeds `testnetPopulationCap`.
- The web `test` script runs the typecheck, that test, and `next build`. The root `test` script includes it.
- `ARCHITECTURE.md` section 15 records that `apps/web` exists, runs on sample data until the API exists, and imports protocol constants from the libraries.
