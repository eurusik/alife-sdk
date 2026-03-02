import type { HazardZoneType } from '../zone/HazardZone';

export interface IArtefactSpawnEvent {
  readonly artefactId: string;
  readonly zoneId: string;
  readonly zoneType: HazardZoneType;
  readonly x: number;
  readonly y: number;
}

/**
 * Host-side port for materialising an artefact in the game world.
 *
 * The SDK computes WHEN and WHERE to spawn — the host decides HOW to create
 * the game object (Phaser Sprite, plain object, etc.).
 *
 * After the artefact is collected, the host must call:
 *   manager.notifyArtefactCollected(zoneId, instanceId, artefactId, collectorId)
 * so the zone's counter decrements.
 */
export interface IArtefactFactory {
  create(event: IArtefactSpawnEvent): void;
}
