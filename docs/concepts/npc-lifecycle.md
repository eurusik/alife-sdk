# NPC Lifecycle

An NPC in this SDK is not just “a sprite with AI”. It moves through different runtime phases.

## The usual path

```text
registerNPC()
  -> offline simulation
  -> player comes close
  -> online AI / engine control
  -> player leaves
  -> offline simulation resumes
  -> save/load or death/despawn
```

## Phase by phase

### 1. Registration

You register the NPC into the simulation with faction, rank, position, HP, and options such as `type: 'human'` or `type: 'monster'`.

### 2. Offline simulation

While far from the player, the SDK is authoritative for:

- terrain choice
- morale
- background movement
- conflict and combat resolution
- task assignment

### 3. Online handoff

When the host decides the NPC matters on screen:

- read the state you care about from the brain or record
- sync that into the live entity
- call `sim.setNPCOnline(id, true)`

### 4. Online control

Now the host engine and optional `@alife-sdk/ai` layer own moment-to-moment behavior.

Typical responsibilities here:

- physics
- animation
- perception
- state-machine updates
- combat feel and immediate reactions

### 5. Offline resume

Before handing the NPC back to the SDK:

- write the live position back into the record
- keep HP and morale coherent through your bridge
- call `sim.setNPCOnline(id, false)`

## Authority model

| Situation | Main authority |
|---|---|
| NPC far away | `@alife-sdk/simulation` |
| NPC close to player | Host engine + optional `@alife-sdk/ai` |
| Save/load | Kernel-level serialization flow |

## Common mistake

Setting an NPC online without any system actually driving it. In that case the SDK stops ticking it, but your game does not move it either, so it appears frozen.

## Related docs

- [Online vs Offline](/concepts/online-offline)
- [Custom Engine](/guides/custom-engine)
- [Phaser Integration](/guides/phaser-integration)
