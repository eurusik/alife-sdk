/**
 * Centralized demo constants.
 *
 * Keeping tunables in one place makes the showcase easier to read and tweak.
 */
export const PLAYER_SPEED = 220; // px/s
export const TICK_MS = 2_000;
export const DETECTION_RANGE = 180; // px — NPC can "see" player within this radius
export const HUD_FONT = 'Trebuchet MS, sans-serif';
export const HUD_PANEL_BG = 0x060914;
export const HUD_PANEL_STROKE = 0x2d3f7a;
export const BG_TOP = 0x161d48;
export const BG_BOTTOM = 0x0b1024;
export const GRENADE_MAX_DAMAGE = 80;
export const GRENADE_MIN_DAMAGE = 22;
export const GOAP_COVER_THREAT_THRESHOLD = 0.25;
export const GOAP_COVER_MOVE_SPEED = 86;

// FSM transition thresholds (memory confidence 0..1)
export const CONF_ALERT = 0.35; // PATROL → ALERT
export const CONF_COMBAT = 0.60; // ALERT  → COMBAT
export const CONF_FORGET = 0.10; // *      → PATROL

export const NPC_DEFS = [
  { entityId: 'stalker_wolf', factionId: 'stalker', hp: 100, combatPower: 70, rank: 3 },
  { entityId: 'stalker_bear', factionId: 'stalker', hp: 80, combatPower: 55, rank: 2 },
  { entityId: 'bandit_knife', factionId: 'bandit', hp: 80, combatPower: 40, rank: 2 },
  { entityId: 'bandit_razor', factionId: 'bandit', hp: 90, combatPower: 60, rank: 3 },
] as const;

