# Funding flow: fiat on-ramp research

This document records the research behind the funding decision in `ARCHITECTURE.md` section 6.1: how a user with a debit card and no crypto experience ends up with USDC on Monad mainnet in their Privy embedded wallet, ready to allocate to an agent. It is self-contained. `ARCHITECTURE.md` carries the decision and the flow; this document carries the vendor-by-vendor evidence.

Status: research and specification only. Nothing here has been built, and no usability testing has been done. Building the flow and testing it with non-crypto-native participants is the remaining work on issue #41.

## Method

Every statement about a vendor is labeled:

- **FACT**: confirmed from an official, current source: the vendor's own documentation, the vendor's own public API, Circle's documentation, Monad's documentation, or a read of the Monad mainnet chain itself. Each FACT carries its source. All sources were accessed on 2026-10-09 unless stated otherwise.
- **ASSUMPTION**: not confirmed from such a source. An assumption is a reason to check, never a reason to build.

A vendor counts as supporting this flow only if a FACT shows it delivers **USDC on Monad mainnet** specifically. Supporting Monad's native token MON, or supporting USDC on another chain, is not support for this flow. Anything not explicitly confirmed is treated as unconfirmed, not as compatible.

Vendor coverage changes often. Every FACT here is time-sensitive and is re-verified before anything capital-critical is built on it.

## The target asset

- **FACT**: Circle lists the USDC contract on Monad mainnet as `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`. Source: https://developers.circle.com/stablecoins/usdc-contract-addresses
- **FACT**: Circle announced USDC and CCTP live on Monad on 2025-11-24. Source: https://www.circle.com/blog/now-available-usdc-cctp-wallets-and-contracts-on-monad
- **FACT**: Circle lists Monad as a CCTP-supported chain with domain ID 15, and Base with domain ID 6. Source: https://developers.circle.com/cctp/cctp-supported-blockchains
- **FACT**: a read of the Monad mainnet RPC (`https://rpc.monad.xyz`, chain ID 143) on 2026-10-09 shows the contract at that address returns `name()` = `USDC`, `decimals()` = 6, `version()` = `2`, and exposes the EIP-3009 constants `TRANSFER_WITH_AUTHORIZATION_TYPEHASH()` and `RECEIVE_WITH_AUTHORIZATION_TYPEHASH()` with their standard values. This is evidence that `transferWithAuthorization` exists on the contract. It is not a test that a relayed call succeeds on Monad.

"USDC" below always means this contract. A token at any other address, whatever its name or symbol, is not the settlement asset.

## Vendor findings

### Ramp Network

- **FACT**: Ramp's public asset API lists `USDC` on chain `MONAD` at `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`, enabled and not hidden, with a minimum purchase of 6.25 EUR, a maximum of 15,000 EUR, and a network fee of 0.01. The same response lists MON, AUSD, and USDT0 on Monad. The contract address matches Circle's. Source: https://api.ramp.network/api/host-api/v3/assets
- **FACT**: Ramp's announcement (dated 2026-06-03) states MON, USDC, USDT0, and AUSD on Monad can be bought with cards, bank transfers, Apple Pay, and Google Pay, and that buying MON and USDC is available in the UK, the US, the EU, and other supported countries. Source: https://rampnetwork.com/blog/monad-live-on-ramp-network
- **FACT**: card fees for USD, EUR, and GBP cards are up to 3.9 percent with a minimum of up to 2.49 EUR, plus a network fee and an optional partner fee set by the integrating app (article last updated 2025-06-25). The asset API reports a fee range of 0.99 to 3.9 percent and a minimum fee of 2.49 EUR. Sources: https://support.rampnetwork.com/en/articles/10415-what-fees-are-charged-when-buying-crypto and the asset API above.
- **FACT**: KYC: in the US and in Ramp's "global" tier, an identity document is required for every purchase, with proof of address, source of wealth, and source of funds at higher amounts. Ramp calls these thresholds a benchmark that can vary (article dated 2025-09-23). Source: https://support.rampnetwork.com/en/articles/441-what-are-the-kyc-limit-requirements-on-ramp-network
- **FACT**: integration is through Ramp's SDK or hosted widget. A `hostApiKey` is required. `enabledCryptoAssets` takes `CHAIN_SYMBOL` values and, given a single value, locks the purchase to that asset. `userAddress` presets the destination address. `webhookStatusUrl` subscribes to purchase events. Source: https://docs.rampnetwork.com/configuration
- **ASSUMPTION**: the identifier for this asset is `MONAD_USDC`. It follows the documented `CHAIN_SYMBOL` format and the API's chain and symbol fields, but was not tested.
- **ASSUMPTION**: whether Europe requires an ID document from the first purchase, and which US states or countries are excluded for USDC on Monad, was not confirmed.
- **ASSUMPTION**: the commercial terms behind a `hostApiKey` (partner agreement, partner fee, any business verification of this project) are unknown until Ramp is contacted.

Verdict: **confirmed** for USDC on Monad mainnet.

### Coinbase Onramp (Coinbase Developer Platform)

- **FACT**: Coinbase's public exchange API lists USDC with a supported network `monad` in status `online`, and lists MON with default network `monad`. Source: https://api.exchange.coinbase.com/currencies/USDC
- **FACT**: the Onramp FAQ states that Onramp and Offramp support all crypto assets and networks available on Coinbase, and points to the Config and Options APIs for the current list per user location. New integrations start in a trial mode with limits until an onboarding form is approved. Source: https://docs.cdp.coinbase.com/onramp/docs/faq
- **FACT**: the Coinbase-hosted Onramp has no developer fee and is available globally to users with a Coinbase account. Guest checkout (no Coinbase account, debit card or Apple Pay) through the hosted widget was scheduled for deprecation on 2026-06-30 in favor of the Headless Onramp API. Headless is US-only, card-only, needs an access fee, and is limited to up to 2.5K USD weekly for cards. Source: https://docs.cdp.coinbase.com/onramp/onramp-overview.md
- **FACT**: Headless Onramp requires a real (non-VoIP) US cell phone number, verified email and phone (phone re-verified at least every 60 days), and acceptance of Coinbase's guest terms. At the time of reading it had a daily limit of 10 successful transactions and a lifetime limit of 15. Prepaid debit cards are not supported. Web Apple Pay needs the app's domain on Coinbase's allowlist. Source: https://docs.cdp.coinbase.com/onramp/headless-onramp/overview
- **ASSUMPTION**: Onramp itself, as opposed to the Coinbase exchange, delivers USDC on the `monad` network. The FAQ's "all networks available on Coinbase" statement and the exchange API together point that way, but the Buy Options API, which needs project credentials, was not called. That one call is what would move Coinbase to confirmed.
- **ASSUMPTION**: Onramp fees for a USDC card purchase were not found in the pages read.

Verdict: **likely but unconfirmed** for USDC on Monad.

### Privy built-in funding

- **FACT**: Privy's React deposit flow uses Stripe and MoonPay once enabled in the dashboard, and Meld after the app completes business verification with Meld. Coinbase is available as a preferred card provider on React Native. Stripe does not support testnets, even in sandbox. The documented Stripe destinations are OUSD on Tempo, Base, Ethereum, and Solana, USDC.e on Tempo, USDC on Base, Solana, Ethereum, Arbitrum, and Polygon, and USDT on Ethereum. Monad is not mentioned. Source: https://docs.privy.io/wallets/funding/prompting-users-to-fund/fiat-onramp
- **FACT**: Privy's global on-ramp announcement (dated 2026-07-07) names Stripe for the US and the EU, on Base, Solana, Ethereum, Arbitrum, and Tempo, and an unnamed regional aggregator elsewhere. Monad is not mentioned. Source: https://privy.io/blog/introducing-global-fiat-onramps
- **FACT**: Privy's native gas sponsorship for embedded wallets ("app pays") lists Monad mainnet and Monad testnet, and uses EIP-7702 with paymasters on EVM chains. Source: https://docs.privy.io/wallets/gas-and-asset-management/gas/overview
- **ASSUMPTION**: Meld's network may route to a provider that supports USDC on Monad. Meld's documentation is password-protected and was not read.

Verdict: **not confirmed** as a USDC-on-Monad on-ramp. Privy remains the wallet, and is the confirmed route for USDC on Base used by the fallback below.

### MoonPay

- **FACT**: MoonPay's public currencies API lists two Monad assets, `mon_mon` (MON) and `musd_mon` (MetaMask USD), both with `isSuspended: true`. USDC is listed on Ethereum, Arbitrum, Arc, Base, Avalanche C-Chain, Tempo (as USDC.e), Hedera, HyperCore, HyperEVM, Noble, Optimism, Polygon, Solana, and Stellar, and not on Monad. Source: https://api.moonpay.com/v3/currencies

Verdict: **no** USDC on Monad. Usable only for the fallback route, as USDC on Base.

### Stripe Crypto Onramp

- **FACT**: Stripe's supported-networks table lists USDC for the onramp on Ethereum, Solana, Polygon, Avalanche, Base, and Stellar, for consumers in the US and the EU, with no EU support for Avalanche, Base, Polygon, or Solana. Monad is not listed for any Stripe product. Source: https://docs.stripe.com/stablecoins/availability

Verdict: **no** USDC on Monad. Usable for the fallback route in the US (USDC on Base) and in the EU (USDC on Ethereum).

### Transak

- **FACT**: Transak's public crypto-currencies API lists two assets on network `monad` (chain ID 143): MON (allowed, pay-in allowed) and MUSD (allowed, pay-in not allowed). Its USDC entries cover 22 networks, none of them Monad. Source: https://api.transak.com/api/v2/currencies/crypto-currencies
- **ASSUMPTION**: Transak's own announcement of MON support at Monad's mainnet launch (https://transak.com/blog/transak-integrates-monad-at-mainnet-launch-unlocking-global-access-to-mon) was seen only through search results; the page refused an automated fetch. It does not change the verdict, which rests on the API.

Verdict: **no** USDC on Monad in the public API. MON only.

### Monad-ecosystem providers

- **FACT**: Monad's on-ramp documentation page lists 45 providers. The listing itself attributes USDC on Monad to Blink (native USDC and MON routes), Calm (bank transfers settling to USDC on Monad), Unifold (MON and USDC on Monad), and Switch (USDC and USDT0 on Monad, an off-ramp to local currency). It also lists Ramp Network, Coinbase, MoonPay, Transak, Meld, Halliday, Onramper, and others without per-asset detail. The page shows no date. Source: https://docs.monad.xyz/tooling-and-infra/onramps
- **ASSUMPTION**: those attributions are the listing's claims. None of these vendors' own documentation was read, so none counts as confirmed here. MoonPay and Transak appear on the same list, yet their own APIs show no USDC on Monad, which is exactly why a listing is not treated as confirmation.

Verdict: **unconfirmed** candidates. Blink, Unifold, and Calm are the first to check if Ramp or Coinbase fall through.

## Comparison

| Vendor | USDC on Monad mainnet | Card, US | Regions for this asset | KYC burden | Card fees | Integration path |
|---|---|---|---|---|---|---|
| Ramp Network | FACT: yes | FACT: yes | FACT: UK, US, EU, other supported countries; exclusions unconfirmed | FACT: ID document from the first purchase in the US and the global tier | FACT: up to 3.9 percent, minimum up to 2.49 EUR, plus network fee | FACT: SDK or hosted widget with `hostApiKey`, asset locked, `userAddress` preset, webhook |
| Coinbase Onramp | ASSUMPTION: likely; exchange lists it, Onramp list not called | FACT: headless, US only | FACT: headless US only; hosted global for Coinbase account holders | FACT: US phone, email, terms; identity data for limit upgrades | FACT: headless access fee; amount not found | FACT: backend session tokens; headless needs app approval |
| Privy built-in (Stripe, MoonPay, Meld) | FACT: no for Stripe and MoonPay; ASSUMPTION for Meld | FACT: yes, other chains | FACT: Stripe US and EU | Handled by the provider | Not found | FACT: Privy SDK |
| MoonPay | FACT: no; Monad assets suspended | n/a | n/a | n/a | n/a | Through Privy, other chains only |
| Stripe | FACT: no | n/a | n/a | n/a | n/a | Through Privy, other chains only |
| Transak | FACT: no; MON only | n/a | n/a | n/a | n/a | n/a |
| Blink, Unifold, Calm | ASSUMPTION: listed by Monad docs | Unread | Unread | Unread | Unread | Unread |

## Ranked shortlist

1. **Ramp Network, primary.** The only vendor confirmed, from its own API and its own announcement, to sell USDC on Monad mainnet, at the contract address Circle publishes, by debit card, Apple Pay, and Google Pay, in the US, the UK, and the EU. Its widget can lock the asset and preset the destination, so the user never picks a network or pastes an address. Its costs: an ID document on the first purchase in the US, a minimum card fee of about 2.49 EUR, and a second vendor beside Privy.
2. **Coinbase Onramp, secondary.** Becomes a confirmed second source once one Buy Options API call shows USDC on `monad`. It gives US users a path with no Coinbase account through the Headless API, and gives existing Coinbase customers anywhere a path from their own balance. It is US-only for guests, needs app approval and an access fee, and its lifetime transaction limit makes it a poor fit for repeat top-ups by the same guest.
3. **Fallback: USDC on Base through Privy's built-in on-ramp, then CCTP to Monad.** Every leg is confirmed to exist: Stripe and MoonPay sell USDC on Base, Privy wraps both, and CCTP connects Base (domain 6) to Monad (domain 15). Used only where neither vendor above serves the user. Its risks are below.

Excluded for direct delivery, on evidence rather than capability: MoonPay, Stripe, and Transak, because their own APIs or documentation show no USDC on Monad today.

## The fallback route and its added risks

Route: the user buys USDC on Base through Privy's flow (Stripe or MoonPay), into the same embedded wallet address. The platform then moves it to Monad with CCTP: burn on Base, wait for Circle's attestation, mint on Monad to the same address. Gas on Base can be sponsored through Privy's native gas sponsorship, which lists Base.

What it adds, compared with direct delivery:

- **Two more transactions and a waiting period** between paying and having funds on Monad. A failure can happen in the middle.
- **Funds can be stranded on Base.** If the burn or the mint fails, the USDC is still the user's, on Base or in a pending attestation, but not where the product expects it. The flow needs a visible "finish moving your funds" recovery path, and the indexer has to track the Base leg.
- **A new dependency on Circle's attestation service and the CCTP contracts** on both chains. CCTP burns and mints native USDC, so the user never holds a wrapped token. Third-party bridges that mint a wrapped USDC are not used: the wrapped token is not the settlement asset, and it adds that bridge's custody risk.
- **Gas on two chains** for the platform to sponsor, and so a second sponsorship budget to cap.
- **ASSUMPTION**: the CCTP version and contract addresses on Monad were not read for this document. They are read from Circle's documentation, and checked against the chain, before the route is built.

## What this means for the product principle

On the primary path the user never sees a network name, a token address, or the word "bridge". They pick a dollar amount, pay with a card inside the vendor's own window, and see the balance arrive. Two places where the principle bends are stated plainly rather than hidden: Ramp's identity check on the first purchase, and its minimum fee, which is a large share of a small first deposit (roughly a quarter of the 10 USD default principal). Both are vendor and regulatory constraints, not choices this project can design away, and both are what usability testing needs to measure.

## Open items

- One Coinbase Buy Options API call with project credentials, to confirm or rule out USDC on `monad` for Onramp.
- Ramp: confirm the `MONAD_USDC` identifier in a sandbox, the excluded US states and countries for this asset, and the partner terms.
- Read the own documentation of Blink, Unifold, and Calm before considering them.
- A testnet spike of the allocation step in `ARCHITECTURE.md` section 6.1, including a relayed EIP-3009 transfer of USDC on Monad.
- Build the flow, then usability-test it with non-crypto-native participants and record the results.
