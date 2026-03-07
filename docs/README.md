# A-Life SDK Docs

This directory contains the React docs and landing site for the A-Life SDK.

The SDK packages, examples, and release tooling live in the repository root. This app only renders the public docs experience.

## Install

```bash
pnpm --dir docs install
```

## Run

From the repository root:

```bash
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

Or run the site directly:

```bash
pnpm --dir docs dev
pnpm --dir docs build
pnpm --dir docs test
```

## What to edit

- `src/pages/Index.tsx` - landing page
- `src/pages/DocPage.tsx` - docs reader shell
- `content/docs/` - markdown source for guides, concepts, packages, examples, and reference pages
- `src/content/docsRegistry.ts` - doc discovery, grouping, and slug resolution

## Content layout

Markdown under `content/docs/` is turned into:

- sidebar groups
- top-level doc routes
- search data
- previous/next navigation

Add docs to the relevant folder:

- `content/docs/guides/`
- `content/docs/concepts/`
- `content/docs/packages/`
- `content/docs/examples/`
- `content/docs/reference/`

## Editing rules

- Keep landing copy direct and developer-facing.
- Prefer runnable proofs over abstract marketing text.
- Put integration details in docs pages, not in the hero.
- Treat `Quick Start` as the shortest honest path to one working loop.
