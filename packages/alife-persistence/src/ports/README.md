# ports

Narrow interface the persistence SDK calls into your storage layer. You
implement it once; the SDK never imports `localStorage`, `fs`, or any other
platform API.

```ts
import type { IStorageBackend } from '@alife-sdk/persistence/ports';
```

---

## What's in this module

| Export | Kind | Implemented by |
|--------|------|----------------|
| `IStorageBackend` | interface | **You** — wraps your platform's storage |

---

## IStorageBackend

Synchronous string key-value store — four methods:

```ts
interface IStorageBackend {
  save(key: string, data: string): void;   // write serialised state
  load(key: string): string | null;        // read, or null if not found
  has(key: string):  boolean;              // existence check
  remove(key: string): void;               // delete a save slot
}
```

**Intentionally synchronous.** For async backends (IndexedDB, remote API),
wrap with a sync cache layer or handle persistence outside `PersistencePlugin`.

---

## Implementing the port

### Browser — `localStorage`

```ts
import type { IStorageBackend } from '@alife-sdk/persistence/ports';

class LocalStorageBackend implements IStorageBackend {
  save(key: string, data: string): void { localStorage.setItem(key, data); }
  load(key: string): string | null      { return localStorage.getItem(key); }
  has(key: string):  boolean            { return localStorage.getItem(key) !== null; }
  remove(key: string): void             { localStorage.removeItem(key); }
}
```

### Node.js / Electron — file system

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IStorageBackend } from '@alife-sdk/persistence/ports';

class FileStorageBackend implements IStorageBackend {
  constructor(private readonly dir: string) {}

  private _filePath(key: string) {
    return path.join(this.dir, `${key}.json`);
  }

  save(key: string, data: string): void {
    fs.writeFileSync(this._filePath(key), data, 'utf8');
  }
  load(key: string): string | null {
    const p = this._filePath(key);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }
  has(key: string): boolean {
    return fs.existsSync(this._filePath(key));
  }
  remove(key: string): void {
    const p = this._filePath(key);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
```

### Tests — `MemoryStorageProvider`

The SDK ships a built-in in-memory implementation for tests and Node.js
environments. No browser or filesystem needed:

```ts
import { MemoryStorageProvider } from '@alife-sdk/persistence/providers';

const storage = new MemoryStorageProvider();
// use as IStorageBackend — plus .clear() and .size() for assertions
```

See [`providers/README.md`](../providers/README.md).

---

## Responsibility boundary

```
SDK (PersistencePlugin)                  You (IStorageBackend)
─────────────────────────────────────────────────────────────
kernel.serialize()
  JSON.stringify(state)
  backend.save(key, json)  ──────────────→  write to localStorage / file / DB

backend.load(key)          ←──────────────  read from storage (or null)
  JSON.parse(raw)
  kernel.restoreState(state)

backend.has(key)           ←──────────────  existence check (for "Continue" button)
backend.remove(key)        ──────────────→  delete save slot
```

The SDK owns serialisation and deserialisation. The backend only moves raw
strings in and out — it never inspects the JSON content.
