# Providers

Use this page when you want a ready-made backend for tests or short-lived runtime experiments.

Providers are built-in `IStorageBackend` implementations shipped with the package. Right now the important one is `MemoryStorageProvider`.

## Import path

```ts
import { MemoryStorageProvider } from "@alife-sdk/persistence/providers";
```

## Minimal usage

```ts
const storage = new MemoryStorageProvider();

storage.save("alife_save", json);
storage.load("alife_save");
storage.has("alife_save");
storage.remove("alife_save");

storage.size();
storage.clear();
```

## What `MemoryStorageProvider` is for

Use it when you need:

- unit tests
- save/load round-trip verification
- temporary runtime experiments without browser or file APIs

It is a `Map`-backed synchronous backend with zero external dependencies.

## What it is not for

Do not use it for:

- player saves across app restarts
- browser persistence across reloads
- production save slots

If the process exits, the data is gone.

## Typical integration

```ts
const storage = new MemoryStorageProvider();
const persistence = new PersistencePlugin({ backend: storage });

kernel.use(persistence);
kernel.init();

const result = persistence.save();
```

This is especially useful in tests where you want to assert save/load behavior without involving `localStorage` or the filesystem.

## Practical rule

Treat providers as convenience backends, not as an alternative persistence architecture.

If you need durable saves, implement `IStorageBackend` for your real platform.

## Failure patterns

- using `MemoryStorageProvider` as if it were durable player storage
- mixing provider-level tests with assumptions about process restarts
- treating built-in providers as the place to encode save-slot policy

## Related pages

- [Persistence package](/docs/packages/persistence)
- [Persistence Plugin](/docs/reference/persistence/plugin)
- [Storage Backend](/docs/reference/persistence/storage-backend)
