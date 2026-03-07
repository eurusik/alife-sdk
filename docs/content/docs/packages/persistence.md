# @alife-sdk/persistence

This package gives you kernel-level save and load with pluggable storage.

## Install

```bash
npm install @alife-sdk/persistence @alife-sdk/core
```

## Add it when

- the runtime state is stable enough to persist
- you need browser, desktop, or memory-backed saves behind one API
- you want save/load behavior at the kernel level instead of inventing your own snapshot pipeline

## Core contract

You implement `IStorageBackend` once:

```ts
interface IStorageBackend {
  save(key: string, data: string): void;
  load(key: string): string | null;
  has(key: string): boolean;
  remove(key: string): void;
}
```

## Start here

1. [Persistence Reference](/docs/reference/persistence/index)
2. [Persistence Plugin](/docs/reference/persistence/plugin)
3. [Storage Backend](/docs/reference/persistence/storage-backend)

## Most used

- [Providers](/docs/reference/persistence/providers)
- [Save / Load guide](/docs/guides/save-load)

## Debug this package

- Save/load lifecycle does not match the expected flow -> [Persistence Plugin](/docs/reference/persistence/plugin)
- Platform backend is behaving strangely -> [Storage Backend](/docs/reference/persistence/storage-backend)
- You need a simple test backend -> [Providers](/docs/reference/persistence/providers)

## Important rule

The plugin is intentionally synchronous. If your real storage is async, put a synchronous cache in front of it or manage that persistence flow separately.

## Package README

- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-persistence/README.md)

## Related pages

- [Persistence Reference](/docs/reference/persistence/index)
- [Save / Load guide](/docs/guides/save-load)
- [Economy package](/docs/packages/economy)
