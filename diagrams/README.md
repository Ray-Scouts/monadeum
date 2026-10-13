# Diagrams

The twelve diagrams used by the documentation site and the root README are generated from code, one Python script per diagram, so they can be reviewed and updated in a pull request like any other source. Each diagram is written in a light and a dark variant to `docs-site/images/diagrams/` as `NN-name-light.svg`, `NN-name-dark.svg`, and the matching `.png` files. The SVG files are what pages reference. The PNG files exist for review and as a raster fallback.

## Regenerate

Requirements: Python 3 (standard library only) and `rsvg-convert` from librsvg on `PATH` for the PNG files (for example `brew install librsvg`).

```
python3 diagrams/generator/render-all.py
```

Run it from the repository root. It runs every script, exits non-zero on any failure, and checks that all 48 files exist. A single diagram can be rendered with `python3 diagrams/generator/04-spend-control-layers.py`.

## Layout

- `toolkit/`: a small SVG layout toolkit. `theme.py` holds the light and dark tokens and the WCAG contrast check, `textfit.py` measures text, `router.py` builds orthogonal edges with rounded corners and does the segment geometry, and `diagram.py` holds the canvas, grid, cards, zones (labeled bands), label pills, legend, SVG writer, and the build assertions.
- `generator/NN-name.py`: one script per diagram. Each docstring states the claim and cites the sections of `ARCHITECTURE.md`, `EVOLUTION.md`, `THREAT-MODEL.md`, `SECURITY.md`, or `ECONOMICS.md` it is derived from, and records the status of each node.
- `generator/render-all.py`: renders everything.

## Design rules

- One claim per figure. The title states it, one subtitle line supports it, and the explanation lives in the page caption, not in the drawing.
- A 1200 px canvas, a grid of equal columns with gutters of at least 40 px, equal card heights, one corner radius. Cards take a title of at most 3 words and an optional subline of at most 6 words. Every arrow carries a label of 1 to 3 words.
- Type sizes are 18 px for card titles, 14.5 px for sublines, arrow labels, and the legend, and 24 px for the title. They are larger than the minimum so that nothing falls under 12 px when a page scales the figure to 1000 px wide.
- Edges are orthogonal, routed on the grid by explicit mode and waypoints chosen in each script.
- Color follows the app tokens in `apps/web/src/app/globals.css`: neutral cards, one accent for the path under discussion, green for allowed or approved, red for refused or reverting. There are no gradients and no shadows.

## What the build enforces

The build raises an error, and no file is written for that diagram, when any of these hold:

- a title, subline, or label exceeds its word limit, or measured text is wider than its card, zone header, or the canvas (widths come from a conservative per-character table, widened for fallback fonts);
- two cards overlap, a card straddles a zone boundary, or two zones overlap;
- a label pill overlaps a card, a zone header, or another pill;
- an edge passes through a card, runs under another edge's label, or crosses a zone header;
- two edges cross, or overlap along a shared stretch without sharing a source or a target (one deliberate crossing may be allowed per diagram with `cross_ok`; none is used today);
- a text color fails WCAG AA (4.5:1) on any surface it sits on in either theme;
- an em dash or an en dash appears in any text.

## Status encoding

One rule in every diagram, shown in the legend row at the bottom of each figure:

| Mark | Meaning |
| --- | --- |
| Filled dot, top right | Observed on Monad testnet, where the documents record the observation |
| Ring, top right | Implemented, but off by default or not yet run on testnet |
| Dashed card outline | Designed, not built, or an unverified assumption |
| No mark | An outside actor, not a component |

Diagram 12 relabels the filled dot as "run and reported", because its stages are a study and not testnet observations. A dashed arrow is a path that is designed or unverified.

## Keeping them true

A diagram states what a document decided. When a decision, a constant, or a deployment state changes in one of the core documents, update the matching script in the same pull request and regenerate. Status marks follow the state recorded in the documents and in `contracts/deployments/*.json` on 2026-10-13, and numeric values labeled as proposed defaults in the documents are labeled the same way in the page captions. Check the reading of each figure in both themes after a change.
