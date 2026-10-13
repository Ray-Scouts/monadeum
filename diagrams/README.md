# Diagrams

The twelve diagrams used by the documentation site are generated from code, one Python script per diagram, so they can be reviewed and updated in a pull request like any other source. Outputs are written to `docs-site/images/diagrams/` as `NN-name.svg` and `NN-name.png`, with a transparent background that works in light and dark mode.

## Regenerate

Requirements: the Graphviz `dot` binary on `PATH` (for example `brew install graphviz`) and Python 3 with the `graphviz` package.

```
python3 -m venv .venv-diagrams
.venv-diagrams/bin/pip install graphviz
.venv-diagrams/bin/python diagrams/generator/render-all.py
```

Run it from the repository root. It runs every script, exits non-zero on any failure, and checks that all 24 files exist. A single diagram can be rendered with `.venv-diagrams/bin/python diagrams/generator/04-spend-control-layers.py`. The `.venv-diagrams/` directory is ignored by git.

## Layout

- `generator/_style.py`: the shared palette, the status convention, the node and edge helpers, and the header with the legend.
- `generator/NN-name.py`: one script per diagram. Each docstring cites the sections of `ARCHITECTURE.md`, `EVOLUTION.md`, `THREAT-MODEL.md`, `SECURITY.md`, or `ECONOMICS.md` it is derived from.
- `generator/render-all.py`: renders everything.

## Conventions

Palette: derived from the app theme in `apps/web/src/app/globals.css` (accent purple, mint, sky, sun, berry, and the warm neutrals). Every piece of text sits on a light card, so the transparent background stays legible on a dark page.

Status is shown by one convention in every diagram, and the legend is part of each image:

| Border | Meaning |
| --- | --- |
| Thick, solid | Implemented and exercised on Monad testnet |
| Thin, solid | Implemented, but off by default or not yet run on testnet |
| Dashed | Designed, not built or not deployed |

Hue and tint carry the kind of component (Monadeum process, contract, third party, safeguard, threat or refusal), never the status. A dashed edge is a path that is designed or switched off. Diagram 12 adds one note to its legend: there, a thick border also marks a study stage that was run and reported.

## Keeping them true

A diagram states what a document decided. When a decision, a constant, or a deployment state changes in one of the core documents, update the matching script in the same pull request and regenerate. Status borders follow the state recorded in the documents on 2026-10-12, and numeric values labeled as proposed defaults in the documents are labeled the same way here.
