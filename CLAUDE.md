# CLAUDE.md

Instructions for any AI assistant working in this repository. This repository is `monadeum`, the product repository for an autonomous evolutionary agent economy on Monad. It is currently private and is intended to go public eventually as an explicit, separate decision, never by default. Every rule below exists to keep this repository ready for that at all times.

## Non-negotiable rules

1. **Never use an em dash, anywhere, in anything this repository produces**: markdown files, code comments, commit messages, pull request descriptions, issue text, generated documentation. Use a comma, a period, a colon, or a hyphen instead. This applies to every file type without exception.
2. **Everything in this repository is professional and high quality, always.** No filler language, no hype, no unverified claims stated as fact. A claim that has not been verified is written as a hypothesis or an assumption, explicitly, not smoothed over into a confident-sounding sentence.
3. **This repository never references, links to, or names the internal management repository.** Research, exploratory notes, and working drafts live in a separate, permanently private repository. Every document here is self-contained: it states its conclusion and the reasoning behind it directly, without depending on anything outside this repository.
4. **No AI attribution anywhere.** Commits, pull requests, and issues are authored as the work of this project's contributors, not credited to an AI assistant.
5. **Commit messages follow conventional commits, one line, lowercase, no trailing punctuation.**

## What this repository is

Decisions and their rationale, not exploratory research. Every top-level document, `ARCHITECTURE.md`, `EVOLUTION.md`, `ECONOMICS.md`, `THREAT-MODEL.md`, `SECURITY.md`, states what was decided and why, grounded in verified facts where they exist and explicit, labeled hypotheses where they do not. Read the relevant document before proposing a change to architecture, evolution mechanics, economics assumptions, threat model, or security controls, and update the document itself when a decision changes, not just the code.

Working order for this project: research first, documentation second, implementation last. A feature or a mechanism is not built here until the decision behind it has been written down and justified in the relevant document.

## Quality bar for any change

- A pull request that touches a decision documented in one of the five core documents updates that document in the same pull request, not in a follow-up.
- A numeric constant, a vendor choice, or a mechanism copied from a document must not be silently changed in code without the document being updated to match, and the reasoning for the change stated.
- Every claim about Monad, a third-party vendor, or a third-party protocol's current behavior is treated as time-sensitive and worth re-verifying before being relied on for anything security- or capital-critical, per the standing caution already documented in this repository's own research history.
- Code and documentation are held to the same bar: correct, precise, and free of unverified assertions presented as settled.
