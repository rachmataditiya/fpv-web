/** Bot entity model + the single source of truth for combat tuning.
 *  Bots satisfy ShotTarget so the player's Weapon can hit them via the
 *  TargetRegistry; AI state fields are consumed by botBrain. */
import * as THREE from 'three';
import type { ShotTarget } from '../weapon';

export type BotKind = 'drone' | 'soldier';
export type BotAiState = 'patrol' | 'alert' | 'engage' | 'seek' | 'dead';

/** Per-kind tuning. Difficulty scaling (B1.7) multiplies onto these. */
export const TUNING = {
  drone: {
    hp: 20,
    hitRadius: 0.6, // matches the 3× mesh (~0.56m half-span) — see DRONE_SCALE
    respawnS: 10,
    hoverAlt: 5,
    patrolSpeed: 6,
    pursueSpeed: 10,
    accel: 12,          // m/s² — kinematic steering clamp
    altMin: 4,          // altitude band above the local floor
    altMax: 8,
    climbSpeed: 6,      // vertical correction rate back into the band
    visionRange: 80,
    fovRad: Math.PI * 2, // all-round camera — no blind side
    hearRange: 50,
    rotorHearRange: 25,
    reactionS: 0.4,
    aimErrBase: 0.08,
    aimErrMin: 0.025,
    aimTightenS: 2,
    aimErrPerMeter: 0.0004,
    aimErrPerSpeed: 0.004,
    burstCount: 4,
    burstInterval: 0.11,
    burstPauseS: 0.9,
    damage: 8,
    yawSlewRad: 4,
    fireConeRad: 0.25,
    losLossToSeekS: 2,
    alertStaleS: 3,
    seekTimeoutS: 8,
    engageMin: 15,      // orbit-strafe distance band while engaging
    engageMax: 30,
    orbitFlipS: 2.5,
  },
  soldier: {
    hp: 30,
    hitRadius: 0.9,
    respawnS: 10,
    height: 1.8,
    eyeHeight: 1.6,     // above feet
    muzzleHeight: 1.4,
    patrolSpeed: 2.2,   // m/s
    strafeSpeed: 1.2,
    visionRange: 60,
    fovRad: (120 * Math.PI) / 180,
    hearRange: 40,
    /** The player's props are loud — heard through walls at close range even
     *  without a shot, so hovering next to a soldier gets you noticed. */
    rotorHearRange: 18,
    reactionS: 0.55,    // LOS acquire → first shot
    // aim error cone (half-angle, rad): tightens with continuous tracking,
    // widens with distance and target speed
    aimErrBase: 0.06,
    aimErrMin: 0.015,
    aimTightenS: 2,
    aimErrPerMeter: 0.0004,
    aimErrPerSpeed: 0.004, // per m/s of target speed
    burstCount: 3,
    burstInterval: 0.13,
    burstPauseS: 1.1,
    damage: 10,
    yawSlewRad: 3,      // rad/s — slow enough that flanking works
    fireConeRad: 0.2,   // must be facing this close to fire
    losLossToSeekS: 2,
    alertStaleS: 3,
    seekTimeoutS: 8,
    maxStepUp: 0.6,     // ledge rejection while walking
    strafeFlipS: 1.5,
  },
} as const;

/** Player damage per blaster hit on a bot: drone = 2 taps, soldier = 3. */
export const PLAYER_SHOT_DAMAGE = 10;
/** The player drone as a bot target: padded well past the ~0.12 m body. */
export const PLAYER_TARGET_RADIUS = 0.3;
/** Bot blaster reach — shorter than the player's 300 m so sniping is a player edge. */
export const BOT_WEAPON_RANGE = 120;

export interface Bot extends ShotTarget {
  kind: BotKind;
  hp: number;
  state: BotAiState;
  vel: THREE.Vector3;
  /** Facing, rad about +Y — mesh rotation convention: facing dir = (−sin yaw, 0, −cos yaw). */
  yaw: number;
  respawnIn: number; // s, counts down while dead
  mesh: THREE.Group;
  /** Per-bot seeded stream (aim error etc.) — placement uses the manager's. */
  rng: () => number;
  // --- AI working state (botBrain) ---
  stateTime: number;
  /** Continuous-LOS time — aim tightens while it grows. */
  trackTime: number;
  reactionLeft: number;
  burstLeft: number;
  fireCooldown: number;
  waypoint: THREE.Vector3 | null;
  /** Time spent on the current waypoint — unreachable ones get abandoned. */
  wpTime: number;
  lastKnown: THREE.Vector3 | null;
  /** Render-only limb swing accumulator. */
  walkPhase: number;
}

/** What the sim tells the bots about the player each tick. */
export interface BotCtx {
  playerPos: THREE.Vector3;
  playerVel: THREE.Vector3;
  playerAlive: boolean;
  /** Player fired this tick — audible stimulus for nearby bots. */
  playerNoise: boolean;
}

export interface BotDiedEvent {
  type: 'bot-died';
  kind: BotKind;
  pos: THREE.Vector3;
}

export interface BotShotEvent {
  type: 'bot-shot';
  from: THREE.Vector3;
  to: THREE.Vector3;
  hitPlayer: boolean;
  damage: number;
}

export type BotEvent = BotDiedEvent | BotShotEvent;
