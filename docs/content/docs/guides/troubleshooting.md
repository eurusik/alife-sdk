# Troubleshooting

Use this page when the runtime boots, but the behavior or output does not match what you expect.

## Start here

Before chasing package-specific bugs, verify the five base signals:

- `kernel.init()` succeeds
- `kernel.start()` succeeds
- `kernel.update(deltaMs)` is actually running
- one terrain exists
- one NPC exists

If any of these is missing, fix that first.

## NPC does not move

The common causes:

- the kernel never started
- `kernel.update(deltaMs)` is not running
- no terrains were registered
- the NPC is online but nothing is driving online AI
- the NPC was never registered into the simulation correctly

Open next:

- [First Living World](/guides/first-living-world)
- [Simulation package](/packages/simulation)

## Ticks run but nothing changes

This usually means the runtime loop exists, but the world model is still empty or blocked.

Check these first:

- at least one `SmartTerrain` exists
- at least one NPC belongs to a valid faction
- the NPC is not stuck in an invalid online/offline state
- you are observing events, not only visuals

Open next:

- [Quick Start](/quick-start)
- [Events](/concepts/events)

## Phaser sprite does not sync with the runtime

The likely causes:

- the sprite was not registered with `PhaserEntityAdapter` before `registerNPC(...)`
- `kernel.update(delta)` is missing from `Scene.update`
- you passed Phaser `time` instead of `delta`
- the scene-side creation and cleanup path is incomplete

Open next:

- [Phaser Integration](/guides/phaser-integration)
- [Phaser package](/packages/phaser)

## Online/offline never switches

That usually means the runtime is running, but the handoff logic is not being applied.

Check these first:

- `OnlineOfflineManager.evaluate(...)` actually runs
- you apply `goOnline` and `goOffline`
- the player position provider returns live coordinates
- the records you pass into the evaluator are the ones you expect

Open next:

- [Online vs Offline](/concepts/online-offline)
- [Phaser Integration](/guides/phaser-integration)

## Offline damage or HP never updates

The usual reasons:

- no simulation bridge exists
- the bridge exists but the entity was never registered in it
- you expect offline damage while running a setup that only owns online behavior

Open next:

- [Simulation package](/packages/simulation)
- [createPhaserKernel](/docs/reference/phaser/create-phaser-kernel)

## Save/load restore fails

Look at the typed reason first:

- `write_failed`
- `parse_failed`
- `restore_failed`

Then verify that the runtime state you are restoring still matches the package versions and data assumptions you saved.

Open next:

- [Save / Load](/guides/save-load)
- [Persistence package](/packages/persistence)

## Large worlds are too expensive

Do not solve that by forcing everything online.

Tune the background runtime first:

- raise `tickIntervalMs`
- reduce offline work budgets
- evaluate online/offline transitions less often
- measure one stable population size before you scale up further

## Related pages

- [Is This For Me?](/guides/is-this-for-me)
- [Choose Your Stack](/guides/choose-your-stack)
- [Custom Engine](/guides/custom-engine)
- [Phaser Integration](/guides/phaser-integration)
