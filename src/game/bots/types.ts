/** Bot entity model + the single source of truth for combat tuning.
 *  Bots satisfy ShotTarget so the player's Weapon can hit them via the
 *  TargetRegistry; AI state fields are consumed by botBrain. */
import * as THREE from 'three';
import type { ShotTarget } from '../weapon';
import type { StatefulRng } from '../rng';

export type BotKind = 'drone' | 'soldier';
export type BotClass = 'rifleman' | 'sniper' | 'heavy' | 'scout';
export type BotAiState = 'patrol' | 'alert' | 'engage' | 'seek' | 'dead';

/** Per-kind tuning (the RIFLEMAN base blocks — classes derive from these).
 *  Difficulty scaling (B1.7) multiplies onto these. Every field is numeric so
 *  MutableTuning maps the whole block to number. */
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
    chargeS: 0,         // class fields — 0 = inert on the rifleman base
    noFire: 0,
    projectileSpeed: 0,
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
    chargeS: 0,         // class fields — 0 = inert on the rifleman base
    noFire: 0,
    projectileSpeed: 0,
  },
} as const;

/** Per-class tuning, derived from the rifleman base blocks above.
 *  sniper/heavy are soldier-based, scout is drone-based. */
export const CLASS_TUNING = {
  sniper: {
    ...TUNING.soldier,
    damage: 34,
    burstCount: 1,
    burstPauseS: 2.5,
    chargeS: 1.5, // aim telegraph before each shot — the red laser window
    aimErrBase: 0.02,
    aimErrMin: 0.004,
    aimErrPerMeter: 0.0002,
    reactionS: 0.8,
    patrolSpeed: 0.6,
    strafeSpeed: 0.6,
    visionRange: 100,
  },
  heavy: {
    ...TUNING.soldier,
    hp: 50,
    damage: 22,
    projectileSpeed: 12, // slow dodgeable rocket instead of hitscan
    burstCount: 1,
    burstPauseS: 2.2,
    aimErrBase: 0.05,
    patrolSpeed: 1.8,
    strafeSpeed: 0.9,
  },
  scout: {
    ...TUNING.drone,
    hp: 10,
    noFire: 1, // spotter only — paints the player for the squad instead
    patrolSpeed: 8,
    pursueSpeed: 12,
    visionRange: 90,
  },
} as const;

/** One squad slot: which body kind plays which class. */
export interface SquadMember {
  kind: BotKind;
  cls: BotClass;
}

/** The default 5-bot squad: rifle/sniper/heavy soldiers + scout/rifle drones. */
export const DEFAULT_SQUAD: SquadMember[] = [
  { kind: 'soldier', cls: 'rifleman' },
  { kind: 'soldier', cls: 'sniper' },
  { kind: 'soldier', cls: 'heavy' },
  { kind: 'drone', cls: 'scout' },
  { kind: 'drone', cls: 'rifleman' },
];

/** Player damage per blaster hit on a bot: drone = 2 taps, soldier = 3. */
export const PLAYER_SHOT_DAMAGE = 10;
/** The player drone as a bot target: padded well past the ~0.12 m body. */
export const PLAYER_TARGET_RADIUS = 0.3;
/** Bot blaster reach — shorter than the player's 300 m so sniping is a player edge. */
export const BOT_WEAPON_RANGE = 120;

/** Writable copy of a readonly tuning block (all-numeric fields). */
export type MutableTuning<T> = { -readonly [K in keyof T]: number };
/** Per-bot tuning snapshots — difficulty-scaled at BotManager construction. */
export type DroneTuning = MutableTuning<typeof TUNING.drone>;
export type SoldierTuning = MutableTuning<typeof TUNING.soldier>;
export type BotTuning = DroneTuning | SoldierTuning;

export interface Bot extends ShotTarget {
  kind: BotKind;
  /** Combat class — rifleman is the base kind behavior, see CLASS_TUNING. */
  botClass: BotClass;
  hp: number;
  state: BotAiState;
  /** Difficulty-scaled tuning snapshot — botBrain reads this, never TUNING. */
  tune: BotTuning;
  /** Suppression-window copy of tune with the aim-error terms ×1.5 —
   *  preallocated at construction; botBrain picks it while suppressLeft > 0. */
  tuneSuppressed: BotTuning;
  /** Sniper aim-telegraph countdown (sim s) — gates firing while > 0. */
  chargeLeft: number;
  /** Suppression window remaining (sim s) — widens the aim cone while > 0. */
  suppressLeft: number;
  vel: THREE.Vector3;
  /** Facing, rad about +Y — mesh rotation convention: facing dir = (−sin yaw, 0, −cos yaw). */
  yaw: number;
  respawnIn: number; // s, counts down while dead
  mesh: THREE.Group;
  /** Per-bot seeded stream (aim error etc.) — placement uses the manager's.
   *  Stateful so replay snapshots can restore the exact draw position. */
  rng: StatefulRng;
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
  /** Combat class of the fallen bot — career stats key off this. */
  cls: BotClass;
  pos: THREE.Vector3;
}

export interface BotShotEvent {
  type: 'bot-shot';
  from: THREE.Vector3;
  to: THREE.Vector3;
  hitPlayer: boolean;
  damage: number;
  /** The bot that fired — killcam keys the killer POV off this. */
  shooter: Bot;
}

/** Scout shared-intel ping: "player seen HERE" — the squad converges. */
export interface BotMarkEvent {
  type: 'bot-mark';
  /** Where the scout saw the player. */
  pos: THREE.Vector3;
  /** Where the scout was when it painted the target. */
  from: THREE.Vector3;
}

/** A heavy's rocket detonated (world hit / proximity fuse / airburst). */
export interface BotBlastEvent {
  type: 'projectile-blast';
  pos: THREE.Vector3;
  damage: number;
}

export type BotEvent = BotDiedEvent | BotShotEvent | BotMarkEvent | BotBlastEvent;
