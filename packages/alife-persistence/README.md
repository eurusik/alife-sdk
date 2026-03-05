# @alife-sdk/persistence

Save/load pipeline for `ALifeKernel` — pluggable storage backends, typed error
codes, zero platform dependencies.

```ts
import { PersistencePlugin, createDefaultPersistenceConfig } from '@alife-sdk/persistence/plugin';
```

Engine-agnostic. Works in the browser (`localStorage`), Electron (file system),
Node.js, or any other runtime — you supply the backend, the SDK handles
serialisation.

---

## Quick start (5 steps)

```ts
import { ALifeKernel }                                         from '@alife-sdk/core';
import { PersistencePlugin, createDefaultPersistenceConfig }   from '@alife-sdk/persistence/plugin';
import type { IStorageBackend }                                from '@alife-sdk/persistence/ports';

// 1. Implement IStorageBackend once for your platform
class LocalStorageBackend implements IStorageBackend {
  save(key: string, data: string): void { localStorage.setItem(key, data); }
  load(key: string): string | null      { return localStorage.getItem(key); }
  has(key: string):  boolean            { return localStorage.getItem(key) !== null; }
  remove(key: string): void             { localStorage.removeItem(key); }
}

// 2. Create the plugin
const persistence = new PersistencePlugin(
  createDefaultPersistenceConfig(new LocalStorageBackend()),
);

// 3. Register with kernel
const kernel = new ALifeKernel({ /* … */ });
kernel.use(persistence);
kernel.init();

// 4. Save (F5 / autosave)
const save = persistence.save();
if (!save.ok) console.error(`[${save.reason}] ${save.message}`);

// 5. Load (F9 / "Continue" button)
if (persistence.hasSave()) {
  const load = persistence.load();
  if (!load.ok) console.warn(`[${load.reason}] ${load.message}`);
}
```

---

## Sub-path imports

| Import | What you get |
|--------|-------------|
| `@alife-sdk/persistence/plugin` | `PersistencePlugin`, `PersistencePluginToken`, `createDefaultPersistenceConfig`, `SaveResult`, `LoadResult` |
| `@alife-sdk/persistence/ports` | `IStorageBackend` — the interface you implement |
| `@alife-sdk/persistence/providers` | `MemoryStorageProvider` — built-in for tests and Node.js |

---

## Architecture

```
   Your code                  PersistencePlugin               IStorageBackend
  ────────────               ───────────────────             ──────────────────
  persistence.save()
    │                          kernel.serialize()
    │                          JSON.stringify(state)
    │                          backend.save(key, json)  ───→  localStorage / file / …
    │
  persistence.load()
    │                          backend.load(key)        ←───  raw JSON string
    │                          JSON.parse(raw)
    │                          kernel.restoreState(state)
    │
  persistence.hasSave()        backend.has(key)         ←───  boolean
  persistence.deleteSave()     backend.remove(key)      ───→  delete entry
```

The plugin owns serialisation and deserialisation. Your backend only moves raw
strings — it never inspects JSON content.

---

## Key concepts

### Pluggable backend

`IStorageBackend` is a 4-method synchronous interface — implement it once for
your target platform:

```ts
interface IStorageBackend {
  save(key: string, data: string): void;
  load(key: string): string | null;
  has(key: string):  boolean;
  remove(key: string): void;
}
```

The SDK ships `MemoryStorageProvider` for tests. Everything else you write.

### Discriminated union results

`save()` and `load()` never throw on normal failure paths — they return a
typed result you pattern-match on:

```ts
const result = persistence.save();

if (result.ok) {
  ui.showToast('Збережено');
} else {
  // result.reason: 'serialize_failed' | 'write_failed'
  // result.message: human-readable detail
  logger.error(`Save failed [${result.reason}]: ${result.message}`);
}
```

| `SaveResult.reason` | When |
|--------------------|------|
| `serialize_failed` | `kernel.serialize()` or `JSON.stringify` threw |
| `write_failed` | `backend.save()` threw (storage full, permissions) |

| `LoadResult.reason` | When |
|--------------------|------|
| `not_found` | No save exists at this key |
| `parse_failed` | Stored data is corrupted / not valid JSON |
| `restore_failed` | `kernel.restoreState()` threw (incompatible save version, corrupted state) |

> **Version field requirement:** save data must be a JSON object with a `version: number` field.
> This is enforced by `kernel.serialize()` — if the field is absent or not a number, `load()`
> returns `{ ok: false, reason: 'parse_failed' }` before attempting to restore.

### Why synchronous?

`IStorageBackend` is intentionally synchronous. Keeping the interface sync makes
serialisation deterministic and predictable — save and load complete in a single
call frame with no hidden state changes between ticks.

From the source comment in `IStorageBackend.ts`:

> NOTE: This interface is intentionally synchronous. For async backends
> (IndexedDB, remote API), wrap with a sync cache layer or use a separate
> async persistence strategy outside of PersistencePlugin.

In practice this means:
- `localStorage`, `sessionStorage`, and `fs.writeFileSync` work directly.
- For **IndexedDB or remote APIs**, maintain an in-memory cache that is written
  asynchronously in the background, and expose the cached values through the sync
  interface. Alternatively, handle that persistence layer entirely outside
  `PersistencePlugin`.

### Error recovery

Because `save()` and `load()` return typed result objects instead of throwing,
you can handle each failure mode explicitly:

| Failure reason | Likely cause | Recommended action |
|---|---|---|
| `write_failed` | Storage quota exceeded or permission denied | Show a UI prompt (e.g. "Storage full — free space and try again"), then retry `save()` with a smaller data set or a different save slot |
| `parse_failed` | Corrupted save data or missing `version` field | Offer the player a "New Game" option or a fallback save slot; do not attempt to restore partial state |
| `restore_failed` | Incompatible save version or corrupted state rejected by `kernel.restoreState()` | Log `result.message` for debugging, then offer "New Game"; the save file can be deleted with `deleteSave()` |

```ts
const load = persistence.load();
if (!load.ok) {
  switch (load.reason) {
    case 'write_failed':
      ui.showPrompt('Storage full — free space and retry.');
      break;
    case 'parse_failed':
      ui.offerNewGame('Save data is corrupted.');
      break;
    case 'restore_failed':
      logger.error(`restore_failed: ${load.message}`);
      ui.offerNewGame('Incompatible save version.');
      break;
  }
}
```

### Multiple save slots

Pass a custom `saveKey` per plugin instance:

```ts
const manual   = new PersistencePlugin({ backend, saveKey: 'save_manual' });
const autosave = new PersistencePlugin({ backend, saveKey: 'save_auto' });
```

---

## Lifecycle

```
new PersistencePlugin(config)

kernel.use(persistence)   ← stores kernel reference (install)
kernel.init()

persistence.hasSave()     ← check before "Continue" button
persistence.save()        ← F5 / autosave timer
persistence.load()        ← F9 / "Continue"
persistence.deleteSave()  ← "New Game"
```

`save()` and `load()` throw only if called before `kernel.use()` —
all other failures are returned as result objects.

---

## Tests

32 tests, 0 failures:

```
pnpm --filter @alife-sdk/persistence test
```

Covers: unit tests for all result codes, integration round-trips with a real
`ALifeKernel` (save → restart → load → verify state), multiple save slots,
corrupted JSON handling, and tick counter preservation.

---

## Module map

| Module | README |
|--------|--------|
| `plugin/` | [`plugin/README.md`](src/plugin/README.md) — entry point, full API reference |
| `ports/` | [`ports/README.md`](src/ports/README.md) — IStorageBackend, platform implementation examples |
| `providers/` | [`providers/README.md`](src/providers/README.md) — MemoryStorageProvider for tests |

## See also

- [`@alife-sdk/simulation`](../alife-simulation/README.md) — primary consumer: saves NPC brain state, terrain assignments, morale
- [`@alife-sdk/economy`](../alife-economy/README.md) — saves inventory, trade history, and quest progress
- [`@alife-sdk/hazards`](../alife-hazards/README.md) — saves hazard zone state and spawned artefact positions
