# Contributing to ALife SDK

Thank you for your interest in contributing!

## Getting started

```bash
git clone https://github.com/eurusik/alife-sdk.git
cd alife-sdk
pnpm install
pnpm build:sdk
pnpm test:sdk
```

## Project structure

```
packages/
  alife-core/        — kernel, ports, plugin host (no external deps)
  alife-simulation/  — offline NPC tick pipeline
  alife-ai/          — online frame-based AI
  alife-economy/     — trade, inventory, quests
  alife-hazards/     — anomaly zones, damage
  alife-persistence/ — save / load
  alife-social/      — greetings, remarks, campfire FSM
  alife-phaser/      — Phaser 3 adapter
examples/            — runnable Node.js examples (tsx)
docs/                — glossary and architecture docs
```

## Development workflow

1. **Pick an issue** or open one describing the change first
2. **Branch** from `main`: `git checkout -b feat/my-feature`
3. **Write tests** — every new behavior needs a test in the same package
4. **Run checks** before pushing:

```bash
pnpm build:sdk    # must pass with 0 TypeScript errors
pnpm test:sdk     # must pass all tests
pnpm lint         # must pass ESLint
```

5. **Open a PR** against `main` — fill in the PR template

## Versioning

This project uses [Changesets](https://github.com/changesets/changesets).
For any user-facing change, add a changeset before opening your PR:

```bash
pnpm changeset
# choose: patch / minor / major
# describe what changed
```

Changesets are committed alongside your code changes.

## Code conventions

- **TypeScript strict** — no `any`, no `as` casts without a comment explaining why
- **No external deps in `@alife-sdk/core`** — the core package must stay zero-dependency
- **Port interfaces over direct engine calls** — if you need engine interaction, add a port
- **Tests live next to the source** — `Foo.ts` → `Foo.test.ts` in the same directory
- **Integration tests** go in `src/__integration__/`

## Reporting bugs

Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md).
Minimal reproduction steps and the error output are required.

## Feature requests

Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md).
Explain the use case — what are you building and what's missing?

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
Be respectful and constructive.
