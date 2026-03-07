# Storage Backend

Use this page when you are implementing the persistence port for your platform.

`IStorageBackend` is intentionally narrow: the SDK owns serialization and restore logic, while your backend only moves raw strings in and out of storage.

## Import path

```ts
import type { IStorageBackend } from "@alife-sdk/persistence/ports";
```

## What you implement

You implement one synchronous key-value backend with four methods:

```ts
interface IStorageBackend {
  save(key: string, data: string): void;
  load(key: string): string | null;
  has(key: string): boolean;
  remove(key: string): void;
}
```

That is the full contract.

## Minimal setup

### Browser example

```ts
class LocalStorageBackend implements IStorageBackend {
  save(key: string, data: string): void {
    localStorage.setItem(key, data);
  }

  load(key: string): string | null {
    return localStorage.getItem(key);
  }

  has(key: string): boolean {
    return localStorage.getItem(key) !== null;
  }

  remove(key: string): void {
    localStorage.removeItem(key);
  }
}
```

### File-backed example

```ts
class FileStorageBackend implements IStorageBackend {
  constructor(private readonly dir: string) {}

  private filePath(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  save(key: string, data: string): void {
    fs.writeFileSync(this.filePath(key), data, "utf8");
  }

  load(key: string): string | null {
    const file = this.filePath(key);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  }

  has(key: string): boolean {
    return fs.existsSync(this.filePath(key));
  }

  remove(key: string): void {
    const file = this.filePath(key);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
```

## Responsibility boundary

The backend owns only:

- write by key
- read by key
- existence check
- delete by key

The backend does not own:

- JSON parsing
- migrations
- save-slot policy
- kernel restore decisions
- gameplay logic

## Why the port is synchronous

`PersistencePlugin` is designed around deterministic save/load calls.

If your real storage is async, the safe options are:

- put a synchronous cache in front of it
- or keep that storage flow outside `PersistencePlugin`

This avoids partial async restore flows inside the runtime.

## Built-in test provider

For tests and Node-like environments, the SDK ships an in-memory implementation:

```ts
import { MemoryStorageProvider } from "@alife-sdk/persistence/providers";

const storage = new MemoryStorageProvider();
```

Use it when you need a fast fake backend without browser or filesystem APIs.

## Failure patterns

- putting app logic or save policy into the backend layer
- using async storage APIs directly without a sync facade
- assuming `has()` proves that `load()` and restore will succeed
- inspecting JSON structure inside the backend instead of leaving that to the plugin

## Related pages

- [Persistence package](/docs/packages/persistence)
- [Persistence Plugin](/docs/reference/persistence/plugin)
- [Providers](/docs/reference/persistence/providers)
