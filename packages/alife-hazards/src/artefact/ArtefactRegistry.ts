import type { HazardZoneType } from '../zone/HazardZone';

export interface IArtefactDefinition {
  readonly id: string;
  readonly zoneTypes: ReadonlyArray<HazardZoneType>;
  readonly weight: number;                        // > 0
  readonly custom?: Record<string, unknown>;       // host: name, price, effects
}

export interface IArtefactSelector {
  select(
    candidates: ReadonlyArray<IArtefactDefinition>,
    zoneType: string,
  ): IArtefactDefinition | null;
}

/**
 * Default selector: weighted random pick proportional to weight field.
 */
export class WeightedArtefactSelector implements IArtefactSelector {
  constructor(private readonly random: { next(): number }) {}

  select(candidates: ReadonlyArray<IArtefactDefinition>): IArtefactDefinition | null {
    if (candidates.length === 0) return null;
    const total = candidates.reduce((s, c) => s + c.weight, 0);
    let roll = this.random.next() * total;
    for (const c of candidates) {
      roll -= c.weight;
      if (roll <= 0) return c;
    }
    return candidates[candidates.length - 1];
  }
}

/**
 * Registry of artefact definitions, queryable by zone type.
 * Call freeze() after loading all definitions; register() throws after freeze.
 */
export class ArtefactRegistry {
  private readonly _entries = new Map<string, IArtefactDefinition>();
  private readonly _byZoneType = new Map<string, IArtefactDefinition[]>();
  private readonly _selector: IArtefactSelector;
  private _frozen = false;

  constructor(selector: IArtefactSelector) {
    this._selector = selector;
  }

  register(def: IArtefactDefinition): this {
    if (this._frozen) throw new Error('[ArtefactRegistry] Cannot register after freeze()');
    if (this._entries.has(def.id)) throw new Error(`[ArtefactRegistry] Duplicate id "${def.id}"`);
    if (def.weight <= 0) throw new Error(`[ArtefactRegistry] weight must be > 0 for "${def.id}"`);

    this._entries.set(def.id, def);
    for (const zt of def.zoneTypes) {
      if (!this._byZoneType.has(zt)) this._byZoneType.set(zt, []);
      this._byZoneType.get(zt)!.push(def);
    }
    return this;
  }

  freeze(): void { this._frozen = true; }
  get isFrozen(): boolean { return this._frozen; }
  get size(): number { return this._entries.size; }

  get(id: string): IArtefactDefinition | undefined { return this._entries.get(id); }
  all(): IterableIterator<IArtefactDefinition> { return this._entries.values(); }

  pickForZone(zoneType: string): IArtefactDefinition | null {
    const candidates = this._byZoneType.get(zoneType);
    if (!candidates || candidates.length === 0) return null;
    return this._selector.select(candidates, zoneType);
  }
}
