# Save / Load

The default save/load path is `PersistencePlugin` at the kernel level.

## Standard approach

1. Implement `IStorageBackend` once
2. Install `PersistencePlugin`
3. Call `save()`, `load()`, `hasSave()`, and `deleteSave()` from your game flow

## Minimal setup

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
```

## What this plugin handles

Your backend only moves raw strings. The plugin handles:

- `kernel.serialize()`
- JSON conversion
- `kernel.restoreState(...)`
- typed failure reasons

## Failure modes are explicit

`save()` and `load()` return typed result objects instead of throwing on normal failures.

| Result | Meaning |
|---|---|
| `serialize_failed` | The runtime state could not be serialized |
| `write_failed` | The backend rejected the write |
| `not_found` | No save exists |
| `parse_failed` | Stored data is corrupted or invalid |
| `restore_failed` | The runtime rejected the saved state |

## Multiple save slots

Create multiple plugin instances with different keys:

```ts
const manual = new PersistencePlugin({ backend, saveKey: 'save_manual' });
const autosave = new PersistencePlugin({ backend, saveKey: 'save_auto' });
```

## When to save manually instead

If you are only snapshotting a subsystem in isolation, direct `serialize()` and `restore()` on that subsystem can make sense. For most game flows, kernel-level persistence is the simpler choice.

## Important simulation note

If you bypass the kernel-level persistence flow and restore `SimulationPlugin` state manually, brain instances need to be rebuilt afterwards. That is a subsystem-level concern; the normal `PersistencePlugin` route is the safer default for most integrations.

## Related docs

- [Persistence package](/packages/persistence)
- [Kernel](/concepts/kernel)
