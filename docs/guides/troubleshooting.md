# Troubleshooting

These are the problems teams usually hit in the first integration pass.

## `kernel.init()` throws validation errors

Usually a required port or plugin dependency is missing.

Checklist:

- `Ports.EntityAdapter`
- `Ports.EntityFactory`
- `Ports.PlayerPosition`
- `SimulationPorts.SimulationBridge` if you use `@alife-sdk/simulation`

If you want a zero-wiring sandbox first, use `createInMemoryKernel()`.

## NPC does not move

The likely causes:

- the kernel never started
- `kernel.update(deltaMs)` is not running
- no terrains were registered
- the NPC is online but nothing is driving online AI

## NPC freezes after going online

That usually means the host flipped `isOnline` to `true`, but there is no online AI driver or engine-side movement controller active for that NPC.

## Phaser scene shows nothing happening

Check these first:

- `kernel.update(delta)` is called every frame
- you passed `delta`, not `time`
- the sprite was registered with the adapter before `registerNPC()`
- `OnlineOfflineManager.evaluate()` actually runs

## AI transitions never fire

For `@alife-sdk/ai`, transitions happen inside state-handler `enter()` and `update()` logic. If your state never calls `ctx.transition(...)`, the driver will stay there forever.

## Cover system always returns `null`

The usual reasons:

- no cover points were registered
- search radius is too small
- cover locks never expire
- score threshold is too strict

## Save/load fails

Look at the typed reason:

- `write_failed`: storage or permissions problem
- `parse_failed`: corrupted save data
- `restore_failed`: incompatible or rejected runtime state

## Large worlds are too expensive

Do not try to solve that by forcing everything online. Tune the offline budgets instead:

- raise `tickIntervalMs`
- adjust `maxBrainUpdatesPerTick`
- reduce offline combat resolution budgets
- re-evaluate terrains less often

## Related references

- [Custom Engine](/guides/custom-engine)
- [Phaser Integration](/guides/phaser-integration)
- [Simulation package](/packages/simulation)
- [AI package](/packages/ai)
