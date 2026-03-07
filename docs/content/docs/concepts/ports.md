# Ports

Ports are the boundary between the SDK and your game.

The SDK defines narrow interfaces for the operations it needs. Your engine code implements those interfaces once, and the rest of the SDK stays framework-agnostic.

## Why ports exist

Without ports, the SDK would need to know about Phaser sprites, Pixi containers, or your own entity system. That would make the package graph rigid and much harder to test.

With ports:

- the SDK can run in Node.js for examples and tests
- the same simulation code can back different engines
- you can stub everything in unit tests

## The three core ports

These are the minimum set most setups provide at initialization time:

| Port token | Interface | Purpose |
|---|---|---|
| `Ports.EntityAdapter` | `IEntityAdapter` | Read and mutate entity state such as position or visibility |
| `Ports.EntityFactory` | `IEntityFactory` | Spawn and destroy entities when the SDK requests it |
| `Ports.PlayerPosition` | `IPlayerPositionProvider` | Return the current player world position |

Plugins can add more ports. For example, `@alife-sdk/simulation` adds `SimulationPorts.SimulationBridge`.

## Port vs adapter

- Port: the contract token or interface the SDK expects
- Adapter: your concrete class or object that fulfills that contract

Example:

```ts
kernel.provide(Ports.EntityAdapter, new PhaserEntityAdapter(scene));
```

`Ports.EntityAdapter` is the port token. `new PhaserEntityAdapter(scene)` is the adapter.

## Good adapter design

- Keep adapters narrow and boring
- Translate engine state without hiding game rules inside them
- Avoid long chains of SDK-specific logic in the adapter layer
- Make them easy to stub in tests

## When to use the in-memory setup

If you are still learning the SDK or building CLI simulations, `createInMemoryKernel()` gives you no-op ports so you can focus on the higher-level behavior first.
