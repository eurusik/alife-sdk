# @alife-sdk/persistence

This package gives you kernel-level save and load with pluggable storage.

It is the cleanest way to say: “the world can stop here and come back later in the same state.”

## Install

```bash
npm install @alife-sdk/persistence @alife-sdk/core
```

## What it gives you

- `PersistencePlugin`
- a small synchronous backend interface
- typed save/load result objects
- support for multiple save slots through different keys

## Add it when

- the runtime state is stable enough to persist
- you need browser, desktop, or memory-backed saves behind one API
- you want save/load behavior at the kernel level instead of inventing your own snapshot pipeline

## The backend contract

You implement `IStorageBackend` once:

```ts
interface IStorageBackend {
  save(key: string, data: string): void;
  load(key: string): string | null;
  has(key: string): boolean;
  remove(key: string): void;
}
```

## A minimal setup

```ts
class LocalStorageBackend implements IStorageBackend {
  save(key: string, data: string): void { localStorage.setItem(key, data); }
  load(key: string): string | null { return localStorage.getItem(key); }
  has(key: string): boolean { return localStorage.getItem(key) !== null; }
  remove(key: string): void { localStorage.removeItem(key); }
}

const persistence = new PersistencePlugin(
  createDefaultPersistenceConfig(new LocalStorageBackend()),
);

kernel.use(persistence);
kernel.init();

const save = persistence.save();
const load = persistence.load();
```

## Why the interface is synchronous

The plugin is designed for deterministic save/load calls inside a single frame.

If your real storage is asynchronous, place a synchronous cache in front of it or manage that persistence layer separately.

## Failure model

`save()` and `load()` return typed result objects instead of throwing on ordinary failures.

That makes it easier to show useful UI for cases like:

- storage full
- corrupted save
- incompatible runtime state

## Save slots

If you want manual saves and autosaves, use different keys:

```ts
const manual = new PersistencePlugin({ backend, saveKey: 'save_manual' });
const autosave = new PersistencePlugin({ backend, saveKey: 'save_auto' });
```

## What your game still owns

- save UI
- slot management UX
- autosave policy
- player-facing recovery flow when load fails

## Common first-time mistakes

### Adding persistence too early

If the runtime model is still changing every day, your save story becomes harder to stabilize.

### Expecting async backends to fit directly

This plugin is intentionally synchronous.

### Ignoring typed failure reasons

The result objects exist so you can handle failure modes explicitly instead of treating every load problem as the same.

## Read next

- [Save / Load guide](/guides/save-load)
- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-persistence/README.md)
