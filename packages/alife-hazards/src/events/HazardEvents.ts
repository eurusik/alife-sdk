export const HazardEvents = {
  HAZARD_DAMAGE:      'hazard:damage',
  ARTEFACT_SPAWNED:   'hazard:artefact_spawned',
  ARTEFACT_COLLECTED: 'hazard:artefact_collected',
  ZONE_EXPIRED:       'hazard:zone_expired',
} as const;

export type HazardEventKey = (typeof HazardEvents)[keyof typeof HazardEvents];

export interface HazardEventPayloads {
  'hazard:damage': {
    readonly entityId: string;
    readonly zoneId: string;
    readonly zoneType: string;
    readonly damage: number;
    readonly damageTypeId: string;
  };
  'hazard:artefact_spawned': {
    readonly artefactId: string;
    readonly zoneId: string;
    readonly x: number;
    readonly y: number;
  };
  'hazard:artefact_collected': {
    readonly artefactId: string;
    readonly instanceId: string;
    readonly zoneId: string;
    readonly collectorId: string;
  };
  'hazard:zone_expired': {
    readonly zoneId: string;
    readonly zoneType: string;
  };
}
