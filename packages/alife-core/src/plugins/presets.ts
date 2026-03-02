import type { ALifeKernel } from '../core/ALifeKernel';
import { FactionsPlugin } from './FactionsPlugin';
import { NPCTypesPlugin } from './NPCTypesPlugin';
import { CombatSchemaPlugin } from './CombatSchemaPlugin';
import { MonstersPlugin } from './MonstersPlugin';
import { AnomaliesPlugin } from './AnomaliesPlugin';
import { SpawnPlugin } from './SpawnPlugin';

/**
 * Install all built-in plugins for a full simulation:
 * factions, NPC types, combat schemas, monsters, anomalies, and spawn.
 *
 * Stub plugins (Surge, Squad, Social, Trade) are not included until
 * they have real implementations. Re-add them via `kernel.use()` as needed.
 *
 * @example
 * ```ts
 * const alife = new ALifeKernel(ports);
 * fullPreset(alife);
 * alife.init();
 * ```
 */
export function fullPreset(kernel: ALifeKernel): ALifeKernel {
  return kernel
    .use(new FactionsPlugin())
    .use(new NPCTypesPlugin())
    .use(new CombatSchemaPlugin())
    .use(new SpawnPlugin())
    .use(new MonstersPlugin())
    .use(new AnomaliesPlugin());
}

/** @deprecated Use {@link fullPreset} instead. Will be removed in v0.2.0. */
export const fullStalkerPreset = fullPreset;

/**
 * Minimal preset: human NPCs and factions only.
 * No monsters, anomalies, or surge.
 *
 * @example
 * ```ts
 * const alife = new ALifeKernel(ports);
 * minimalPreset(alife);
 * alife.init();
 * ```
 */
export function minimalPreset(kernel: ALifeKernel): ALifeKernel {
  return kernel
    .use(new FactionsPlugin())
    .use(new NPCTypesPlugin())
    .use(new CombatSchemaPlugin())
    .use(new SpawnPlugin());
}
