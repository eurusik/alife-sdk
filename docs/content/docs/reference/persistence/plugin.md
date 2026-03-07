# Persistence Plugin

Use this page when you need to wire save/load into the kernel in a way that is explicit about success and failure.

`PersistencePlugin` is the runtime coordinator for save/load. It is not a storage engine by itself.

## Import path

```ts
import {
  PersistencePlugin,
  PersistencePluginToken,
  createDefaultPersistenceConfig,
} from "@alife-sdk/persistence/plugin";
import type {
  IPersistencePluginConfig,
  SaveResult,
  LoadResult,
} from "@alife-sdk/persistence/plugin";
```

## What you create

In a normal integration you create:

1. one storage backend
2. one `PersistencePlugin`
3. one kernel registration through `kernel.use(persistence)`

After that you call:

- `save()`
- `load()`
- `hasSave()`
- `deleteSave()`

## Minimal working example

```ts
class LocalStorageBackend implements IStorageBackend {
  save(key: string, data: string) { localStorage.setItem(key, data); }
  load(key: string) { return localStorage.getItem(key); }
  has(key: string) { return localStorage.getItem(key) !== null; }
  remove(key: string) { localStorage.removeItem(key); }
}

const persistence = new PersistencePlugin(
  createDefaultPersistenceConfig(new LocalStorageBackend()),
);

kernel.use(persistence);
kernel.init();

const saveResult = persistence.save();
const loadResult = persistence.hasSave() ? persistence.load() : { ok: false };
```

## What the plugin owns

The plugin owns:

- serialization orchestration
- JSON conversion
- save key selection
- typed result objects

The backend owns only moving raw strings in and out of storage.

## Lifecycle

The recommended order is:

1. create backend
2. create plugin
3. `kernel.use(persistence)`
4. `kernel.init()`
5. call `save()` / `load()` when the game needs them

Important rule:

`save()` and `load()` are valid only after the plugin is installed into the kernel.

## Result model

### Save

```ts
type SaveResult =
  | { ok: true }
  | { ok: false; reason: "serialize_failed" | "write_failed"; message: string };
```

### Load

```ts
type LoadResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "parse_failed" | "restore_failed"; message: string };
```

These result unions are one of the main reasons the plugin is useful: they force the caller to distinguish between very different failure modes.

## Save slots

The save slot seam is just `saveKey`.

Use different keys for:

- manual saves
- autosaves
- alternate profiles

That keeps slot policy outside the storage backend.

## What can fail where

| Step | Typical failure |
|---|---|
| kernel serialization | `serialize_failed` |
| backend write | `write_failed` |
| backend read missing | `not_found` |
| JSON parse or missing version | `parse_failed` |
| kernel restore | `restore_failed` |

## Practical usage rule

Do not treat `hasSave()` as a guarantee that `load()` will succeed.

It only means something exists at that key. The stored data can still be corrupt or incompatible.

## Failure patterns

- calling save/load before the plugin is installed
- expecting async storage to fit directly into this sync contract
- treating all load failures as one generic error
- assuming a successful read implies a successful restore
- putting save-slot or UI policy into the backend instead of the caller

## Related pages

- [Persistence package](/docs/packages/persistence)
- [Storage Backend](/docs/reference/persistence/storage-backend)
- [Providers](/docs/reference/persistence/providers)
- [Save / Load guide](/docs/guides/save-load)
