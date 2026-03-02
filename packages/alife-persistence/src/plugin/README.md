# plugin

`PersistencePlugin` — kernel plugin that wires save/load to a pluggable
`IStorageBackend`. Serialises the full kernel state to JSON and writes it
through the backend you provide.

```ts
import { PersistencePlugin, PersistencePluginToken, createDefaultPersistenceConfig } from '@alife-sdk/persistence/plugin';
import type { IPersistencePluginConfig, SaveResult, LoadResult } from '@alife-sdk/persistence/plugin';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `PersistencePlugin` | class | Save/load kernel state via any storage backend |
| `PersistencePluginToken` | token | Lookup key for `kernel.get()` |
| `IPersistencePluginConfig` | interface | Constructor config |
| `SaveResult` | type | Discriminated union — save outcome |
| `LoadResult` | type | Discriminated union — load outcome |
| `createDefaultPersistenceConfig` | function | Config factory with sensible defaults |

---

## Quick start

```ts
import { ALifeKernel }                                           from '@alife-sdk/core';
import { PersistencePlugin, createDefaultPersistenceConfig }     from '@alife-sdk/persistence/plugin';
import { LocalStorageBackend }                                   from '@alife-sdk/persistence/providers';

// 1. Create the plugin (supply your backend)
const persistence = new PersistencePlugin(
  createDefaultPersistenceConfig(new LocalStorageBackend()),
);

// 2. Register with kernel
const kernel = new ALifeKernel({ /* … */ });
kernel.use(persistence);
kernel.init();

// 3. Save (e.g. on F5 or autosave timer)
const saveResult = persistence.save();
if (!saveResult.ok) {
  console.error(`Save failed [${saveResult.reason}]: ${saveResult.message}`);
}

// 4. Load (e.g. on F9 or "Continue" button)
if (persistence.hasSave()) {
  const loadResult = persistence.load();
  if (!loadResult.ok) {
    console.warn(`Load failed [${loadResult.reason}]: ${loadResult.message}`);
  }
}

// 5. Delete save (e.g. "New Game" button)
persistence.deleteSave();
```

> **`save()` and `load()`** are available only after `kernel.use(plugin)`.
> Calling them before that throws.

---

## IPersistencePluginConfig

```ts
interface IPersistencePluginConfig {
  backend:   IStorageBackend;  // required — where to read/write serialised state
  saveKey?:  string;           // storage key, default: 'alife_save'
}
```

### `createDefaultPersistenceConfig`

Fills in the default `saveKey`. Pass your backend as the only required argument:

```ts
// Default key ('alife_save')
const config = createDefaultPersistenceConfig(new LocalStorageBackend());

// Custom key — multiple save slots
const slot2 = createDefaultPersistenceConfig(new LocalStorageBackend(), {
  saveKey: 'alife_save_slot2',
});
```

---

## API

### `save(): SaveResult`

Serialises the kernel state and writes it to the backend:

```
kernel.serialize()  →  JSON.stringify()  →  backend.save(key, data)
```

Returns a discriminated union — never throws on normal failure paths:

```ts
type SaveResult =
  | { ok: true }
  | { ok: false; reason: 'serialize_failed' | 'write_failed'; message: string }
```

| `reason` | When |
|----------|------|
| `serialize_failed` | `kernel.serialize()` or `JSON.stringify()` threw |
| `write_failed` | `backend.save()` threw (storage full, permissions, etc.) |

### `load(): LoadResult`

Reads from the backend and restores into the kernel:

```
backend.load(key)  →  JSON.parse()  →  kernel.restoreState(state)
```

```ts
type LoadResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'parse_failed'; message: string }
```

| `reason` | When |
|----------|------|
| `not_found` | `backend.load()` returned `null` — no save exists at this key |
| `parse_failed` | Stored data is not valid JSON (corrupted save) |

### `hasSave(): boolean`

Check if a save exists before trying to load — useful for showing a
"Continue" button in the main menu:

```ts
mainMenu.showContinueButton(persistence.hasSave());
```

### `deleteSave(): void`

Remove the save slot — use for "New Game" flows:

```ts
persistence.deleteSave();
kernel.reset(); // restart simulation from scratch
```

---

## Lifecycle

```
new PersistencePlugin(config)

kernel.use(persistence)       ← install(): stores kernel reference
kernel.init()

// any time after init:
persistence.save()            ← serialize + write
persistence.load()            ← read + restore
persistence.hasSave()         ← check existence
persistence.deleteSave()      ← remove
```

---

## PersistencePluginToken

Retrieve the plugin anywhere that has kernel access:

```ts
import { PersistencePluginToken } from '@alife-sdk/persistence/plugin';

const persistence = kernel.get(PersistencePluginToken);
persistence.save();
```

---

## Error handling patterns

### Show UI feedback

```ts
const result = persistence.save();
if (result.ok) {
  ui.showToast('Game saved');
} else if (result.reason === 'write_failed') {
  ui.showToast('Storage full — could not save', 'error');
} else {
  ui.showToast('Save error: ' + result.message, 'error');
}
```

### Silent autosave with logging

```ts
function autosave() {
  const result = persistence.save();
  if (!result.ok) {
    logger.warn(`[autosave] ${result.reason}: ${result.message}`);
  }
}
```

### Safe load on startup

```ts
function tryLoadSave(): boolean {
  if (!persistence.hasSave()) return false;
  const result = persistence.load();
  if (!result.ok) {
    logger.error(`[load] ${result.reason}: ${result.message}`);
    // Optionally delete corrupt save:
    // persistence.deleteSave();
    return false;
  }
  return true;
}
```

---

## Testing tips

Use `MemoryStorageProvider` — no browser APIs, no filesystem:

```ts
import { PersistencePlugin }       from '@alife-sdk/persistence/plugin';
import { MemoryStorageProvider }   from '@alife-sdk/persistence/providers';

const storage     = new MemoryStorageProvider();
const persistence = new PersistencePlugin({ backend: storage });

persistence.install(mockKernel);

const saveResult = persistence.save();
expect(saveResult.ok).toBe(true);
expect(storage.size()).toBe(1);   // one entry written

const loadResult = persistence.load();
expect(loadResult.ok).toBe(true);

storage.clear(); // test teardown
```
