# Monadeum documentation site

Source of the public documentation, built with [Mintlify](https://mintlify.com) and intended to be served at https://docs.monadeum.xyz. The pages are derived from the core documents in the repository root (`ARCHITECTURE.md`, `EVOLUTION.md`, `ECONOMICS.md`, `THREAT-MODEL.md`, `SECURITY.md`, `BRIEF.md`), from `contracts/deployments/`, and from `simulation/results/`. Each page cites its source. When a page and its source disagree, the source is correct and the page is a defect.

## Layout

| Path | Purpose |
| --- | --- |
| `docs.json` | Site configuration: theme, colors, logo, navigation, navbar, footer, SEO |
| `index.mdx` and `*/` | Pages, grouped as Introduction, Concepts, Architecture, Security, Economics, Evidence, Deployments, Reference |
| `logo/light.svg`, `logo/dark.svg`, `favicon.svg` | Brand assets, derived from the app's logo mark and color tokens in `apps/web/src/app/globals.css` |
| `images/diagrams/` | The twelve system diagrams (`01-system-architecture.svg` through `12-evidence-chain.svg`), referenced by the pages |

## Run it locally

Requires Node.js 20.17.0 or newer.

```bash
cd docs-site
npx mint@latest dev
```

The preview serves at http://localhost:3000, or at the port you pass with `--port`. Equivalent with bun: `bunx mint@latest dev`.

Check the site before committing:

```bash
npx mint@latest validate        # builds the site and fails on warnings or errors
npx mint@latest broken-links    # reports links and images that do not resolve
```

`broken-links` reports a missing image for every diagram path until the files in `images/diagrams/` exist. Those paths are deliberate: another change produces the diagrams, and the pages reference them at their final paths.

## Rules for editing

- Follow the repository's `CLAUDE.md`: no em dashes or en dashes, professional language with no hype, and an unverified claim written as an assumption or a hypothesis, with the date a verified claim was checked.
- Numeric constants, addresses, and block numbers are copied exactly from their source document or from `contracts/deployments/monad-testnet.json`. Never retype one from memory.
- A change to a decision documented in a core document updates that document in the same pull request, then the page.
- Do not link to or name any repository other than this one.

## Publish

These steps are done in the Mintlify dashboard and at the DNS provider. They are not performed by this repository.

1. Create or sign in to a Mintlify account and open the dashboard.
2. Install the Mintlify GitHub app on the organization or account that owns this repository, choosing "Only select repositories" and selecting this repository. Installing needs organization ownership or administrator permission. The required permissions are the ones the installer lists.
3. In the dashboard's Git settings, choose GitHub as the provider and select this repository and the branch to deploy (normally `main`).
4. Because the documentation is in a subdirectory of the repository, set the docs path to `docs-site` in the same settings. Mintlify's setup lets you specify a subdirectory when the docs are not at the repository root.
5. Add the custom domain `docs.monadeum.xyz` on the dashboard's custom domain page. The dashboard then displays the DNS records to create. Create exactly the records and values shown there at the DNS provider for `monadeum.xyz`. Mintlify's documentation describes two verification TXT records and one CNAME record, and says to add the TXT records first and wait for verification before changing the CNAME. The target values are shown only in the dashboard and are intentionally not written here.
6. Wait for DNS propagation and for the certificate to be issued, then open https://docs.monadeum.xyz and confirm the pages and diagrams load.
7. After the first deploy, each push to the deployed branch redeploys the site.

If a deployment does not trigger, confirm that the app is installed on the right repository and that the push was to the branch configured in Git settings.

## Not yet verified

- The site configuration passes `mint validate` (checked 2026-10-12 with the CLI fetched by `bunx mint@latest`). It has not been deployed to Mintlify's hosting, so rendering on the hosted site, the custom domain, and the social preview images are unobserved.
- `favicon.svg` is an SVG. Mintlify documents a PNG example for `favicon`. Whether the hosted site renders an SVG favicon in every browser is unverified, and a PNG export is the fallback.
- The `Evidence` navbar link and the live evidence page point at https://app.monadeum.xyz/evidence, which is built separately and may not be live yet.
