/** Bot entity model + the single source of truth for combat tuning.
 *  Bots satisfy ShotTarget so the player's Weapon can hit them via the
 *  TargetRegistry; AI state fields are consumed by botBrain (B1.5/B1.6). */
import * as THREE from 'three';
import type { ShotTarget } from '../weapon';

export type BotKind = 'drone' | 'soldier';
export type BotAiState = 'patrol' | 'alert' | 'engage' | 'seek' | 'dead';

/** Per-kind tuning. Difficulty scaling (B1.7) multiplies onto these. */
export const TUNING = {
  drone: { hp: 20, hitRadius: 0.35, respawnS: 10, hoverAlt: 5 },
  soldier: { hp: 30, hitRadius: 0.9, respawnS: 10 },
} as const;

/** Player damage per blaster hit on a bot: drone = 2 taps, soldier = 3. */
export const PLAYER_SHOT_DAMAGE = 10;

export interface Bot extends ShotTarget {
  kind: BotKind;
  hp: number;
  state: BotAiState;
  vel: THREE.Vector3;
  /** Facing, rad about +Y (render + future aim). */
  yaw: number;
  respawnIn: number; // s, counts down while dead
  mesh: THREE.Group;
}

/** What the sim tells the bots about the player each tick. */
export interface BotCtx {
  playerPos: THREE.Vector3;
  playerVel: THREE.Vector3;
  playerAlive: boolean;
  /** Player fired this tick — audible stimulus for nearby bots (B1.5). */
  playerNoise: boolean;
}

export interface BotDiedEvent {
  type: 'bot-died';
  kind: BotKind;
  pos: THREE.Vector3;
}
