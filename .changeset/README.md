# Changesets

This directory manages versioning and changelogs for the @alife-sdk monorepo.

## Workflow

```bash
# 1. After making changes, create a changeset:
pnpm changeset

# 2. When ready to release, bump versions + generate CHANGELOGs:
pnpm version-packages

# 3. Publish to npm:
pnpm release
```
