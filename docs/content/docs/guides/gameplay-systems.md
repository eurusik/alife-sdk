# Gameplay Systems

Once the core world loop works, you can add the opt-in gameplay layers one by one.

## Add them in this order

1. `social` if you need greetings, remarks, and campfire behavior
2. `hazards` if the environment should shape movement and danger
3. `economy` if you need inventory, trade, and quests
4. `persistence` when the runtime state is stable enough to save

That order is practical, not mandatory. It keeps the debugging surface smaller.

## What each package asks from you

| Package | What it gives you | What you still implement |
|---|---|---|
| `@alife-sdk/social` | Greetings, remarks, campfire logic | `INPCSocialProvider` and `ISocialPresenter` |
| `@alife-sdk/hazards` | Zone damage, anomaly logic, artefact spawns | Live entity list per frame and one artefact creation callback |
| `@alife-sdk/economy` | Inventory, trade, quests | Your UI, item presentation, and optional ports |
| `@alife-sdk/persistence` | Save/load pipeline | A synchronous storage backend |

## Social

Use it when you already know which NPCs are online and what faction they belong to.

The package gives you three interaction types:

- meet: short greetings near the player
- remark: ambient one-off lines in a terrain
- campfire: multi-NPC storytelling loops

If your online NPC discovery is still unstable, wait before adding social.

## Hazards

Use it when the map itself should matter.

The runtime contract is:

- you define hazard zones
- each frame you call `hazards.manager.tick(deltaMs, liveEntities)`
- the plugin emits damage and artefact events

This package stays engine-agnostic because you provide the live entities and the spawn callback.

## Economy

Use it when your game needs inventory, trade, or quest state.

The package is three systems in one:

- `Inventory`
- trade helpers like `executeBuy` and `executeSell`
- `QuestEngine`

You can use the whole plugin or only the specific subsystem you need.

## Persistence

Use it when you are ready to freeze the current runtime model into a save format.

`PersistencePlugin` saves and restores the kernel state through a synchronous backend. Typical backends are:

- browser local storage
- Electron or desktop file saves
- memory-backed saves for tests

## Integration advice

Do not add all four packages in the same commit if you are still proving the core loop. Add one, verify it, then move on.

## Related docs

- [Social package](/packages/social)
- [Hazards package](/packages/hazards)
- [Economy package](/packages/economy)
- [Save / Load guide](/guides/save-load)
