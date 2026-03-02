# providers

Built-in `IStorageBackend` implementations shipped with the SDK.

```ts
import { MemoryStorageProvider } from '@alife-sdk/persistence/providers';
```

---

## What's in this module

| Export | Kind | Use when |
|--------|------|----------|
| `MemoryStorageProvider` | class | Tests, Node.js, any environment without persistent storage |

---

## MemoryStorageProvider

In-memory backend — stores data in a `Map<string, string>`. Zero browser or
filesystem dependencies. Implements the full `IStorageBackend` contract plus
two test helpers:

```ts
const storage = new MemoryStorageProvider();

// IStorageBackend contract
storage.save('alife_save', json);
storage.load('alife_save');    // → string | null
storage.has('alife_save');     // → boolean
storage.remove('alife_save');

// Test helpers (beyond the port contract)
storage.size();   // → number of stored entries
storage.clear();  // → remove all entries
```

### Use with PersistencePlugin

```ts
import { PersistencePlugin }     from '@alife-sdk/persistence/plugin';
import { MemoryStorageProvider } from '@alife-sdk/persistence/providers';

const storage     = new MemoryStorageProvider();
const persistence = new PersistencePlugin({ backend: storage });

kernel.use(persistence);
kernel.init();

persistence.save();
expect(storage.size()).toBe(1);

persistence.load();

storage.clear(); // test teardown
```

---

## Writing your own backend

`MemoryStorageProvider` is not intended for production persistence — it loses
all data when the process restarts. For real storage implement `IStorageBackend`
yourself:

```ts
import type { IStorageBackend } from '@alife-sdk/persistence/ports';

class LocalStorageBackend implements IStorageBackend {
  save(key: string, data: string)  { localStorage.setItem(key, data); }
  load(key: string)                { return localStorage.getItem(key); }
  has(key: string)                 { return localStorage.getItem(key) !== null; }
  remove(key: string)              { localStorage.removeItem(key); }
}
```

See [`ports/README.md`](../ports/README.md) for more backend examples
(Node.js file system, Electron, etc.).
