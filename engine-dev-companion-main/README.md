# A-Life SDK Docs Site

This app is the React-based docs and landing site for the A-Life SDK.

It is not the SDK workspace itself. The SDK packages, examples, and monorepo tooling live in the repository root.

## Run locally

```bash
cd engine-dev-companion-main
npm install
npm run dev
```

## Build

```bash
cd engine-dev-companion-main
npm run build
npm test
```

## Site structure

- `src/pages/Index.tsx` -> landing page
- `src/pages/DocPage.tsx` -> docs reader shell
- `content/docs/` -> markdown source for guides, concepts, packages, examples, and reference pages
- `src/content/docsRegistry.ts` -> doc discovery, grouping, and slug resolution

## Content model

The docs site loads markdown files from `content/docs/` at build time and turns them into the sidebar, top navigation, search index, and doc routes.

Add a new doc by placing a markdown file in the correct folder:

- `content/docs/guides/`
- `content/docs/concepts/`
- `content/docs/packages/`
- `content/docs/examples/`
- `content/docs/reference/`

## Design intent

The site is optimized for three developer questions:

1. Does this SDK fit my game?
2. What is the shortest path to one honest proof?
3. Where are the real integration seams once I decide to adopt it?
