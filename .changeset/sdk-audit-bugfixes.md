---
"@alife-sdk/core": patch
"@alife-sdk/ai": patch
"@alife-sdk/simulation": patch
"@alife-sdk/economy": patch
"@alife-sdk/social": patch
"@alife-sdk/mapgen": patch
---

Fix 94 bugs across all SDK packages, add ~770 regression tests

**State handlers**: ChargeState timeout, CombatState cover cooldown/targetId/morale guard, RetreatState NaN sentinel/time limit, FleeState safe transition/origin fix, WoundedState medkit cooldown, TakeCoverState field aliasing, IdleState/PatrolState corpse dedup, CampState/SleepState false enemy broadcast, EvadeGrenadeState configurable duration/premature exit, KillWoundedState target refresh

**GOAP**: fix restore index, remove abort on SUCCESS, fix prevAction abort, freeze goal singletons, remove ENEMY_PRESENT from critical goal

**Navigation**: PathSmoother arc sweep wrapping, SmoothPathFollower getter mutation, Pathfinder fractional costs, Grid O(1) BFS, NPCGraphMover maxSteps

**Combat**: GrenadeOpportunityRule conditions, CombatTransitionHandler transition map, LoadoutBuilder maxAmmo, OfflineCombatResolver HP check/pool fix

**Map generation**: PoissonDisk seed retry, PropsPass bounds/occupation/collider, MapGenerator seed capture, MapScorer Gini/breakdown, ZoneTemplate Y-flip

**Simulation**: SurgeManager entityId, NPCBrain dispatch/slots, SquadManager destroy, Squad morale, TraderInventory baseline

**Core**: StateMachine injectable clock/history cap, Clock hour skip, DangerManager escape direction, SuspicionAccumulator threshold, Rng weightedPick/fork, ReactiveQuery swap, SpatialGrid bounds, GOAPPlanner hash

**Social/Economy**: CampfireFSM stale bubbles/aliasing, ContentPool loop cap, PricingEngine sell price, QuestEngine zero-increment, NPCRelationRegistry safe split

**Breaking**: renamed `lastSupressiveFireMs` → `lastSuppressiveFireMs`, `stalkUnclockDistance` → `stalkUncloakDistance`, removed dead fields
