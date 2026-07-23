/** Player arsenal — hitscan weapons fired from the nose along the FPV camera.
 *
 *  Three configs (WEAPON_CONFIGS): the BLASTER (today's rifle: tap or hold to
 *  auto-fire, heat-based spread), the BURST (3-round burst per trigger, tight
 *  spread, post-burst pause), and the RAILGUN (hold to charge, release at full
 *  charge → one heavy shot, long cooldown, no heat).
 *
 *  Deterministic: fire requests are queued by the input action edge / trigger
 *  level and consumed inside the fixed physics tick. World geometry blocks
 *  shots (CollisionWorld sweep); targets are tested as bounding spheres —
 *  nearest hit wins. */
import * as THREE from 'three';
import type { CollisionWorld } from '../physics/quad';
import { mulberry32Stateful } from './rng';
import type { StatefulRng } from './rng';
import { PLAYER_SHOT_DAMAGE } from './bots/types';

export const WEAPON_RANGE = 300;   // m
export const WEAPON_COOLDOWN = 0.11; // s — ~9 rounds/s, rifle-like (blaster)

export type WeaponId = 'blaster' | 'burst' | 'railgun';

export interface WeaponConfig {
  id: WeaponId;
  name: string;              // HUD label, uppercase
  damage: number;
  cooldownS: number;
  heatPerShot: number;
  heatCoolRate: number;
  heatMax: number;
  spreadPerHeat: number;     // rad of cone half-angle per heat unit
  burstCount: number;        // 1 = single-shot
  burstIntervalS: number;    // 0 for single-shot
  chargeS: number;           // 0 = instant; 0.8 for railgun
}

export const WEAPON_CONFIGS: Record<WeaponId, WeaponConfig> = {
  blaster: {
    id: 'blaster', name: 'BLASTER',
    damage: PLAYER_SHOT_DAMAGE, cooldownS: WEAPON_COOLDOWN,
    heatPerShot: 1, heatCoolRate: 5, heatMax: 6, spreadPerHeat: 0.0045,
    burstCount: 1, burstIntervalS: 0, chargeS: 0,
  },
  burst: {
    id: 'burst', name: 'BURST',
    damage: 7, cooldownS: 0.28,
    heatPerShot: 0.5, heatCoolRate: 5, heatMax: 6, spreadPerHeat: 0.002,
    burstCount: 3, burstIntervalS: 0.06, chargeS: 0,
  },
  railgun: {
    id: 'railgun', name: 'RAILGUN',
    damage: 40, cooldownS: 2.0,
    heatPerShot: 0, heatCoolRate: 5, heatMax: 6, spreadPerHeat: 0.0045,
    burstCount: 1, burstIntervalS: 0, chargeS: 0.8,
  },
};

export interface ShotTarget {
  /** Sphere hit test: world position + radius. */
  pos: THREE.Vector3;
  radius: number;
  alive: boolean;
}

export interface ShotResult {
  from: THREE.Vector3;
  to: THREE.Vector3;              // impact point or max-range end
  targetIndex: number | null;     // which ShotTarget was hit (null = world/air)
  hitWorld: boolean;
  damage: number;                 // from the active config
}

/** Sim-relevant weapon state for replay snapshots — restore() is symmetric,
 *  so re-simulation from a snapshot draws the exact same rng sequence. */
export interface WeaponState {
  cooldown: number;
  heat: number;
  rngState: number;
  configId: WeaponId;
  chargeT: number;
  burstLeft: number;
  burstTimer: number;
}

const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export class Weapon {
  private cfg: WeaponConfig;
  private cooldown = 0;
  private queued = false;
  /** Sustained-fire heat → spread cone (first shot is laser-accurate). */
  private heat = 0;
  private rng: StatefulRng = mulberry32Stateful(0xf1e2d3);
  /** Trigger level — held acts like a per-tick requestFire on instant
   *  configs; on charge configs it builds the charge. */
  private held = false;
  private chargeT = 0;
  private burstLeft = 0;
  private burstTimer = 0;

  constructor(id: WeaponId = 'blaster') {
    this.cfg = WEAPON_CONFIGS[id];
  }

  get config(): WeaponConfig {
    return this.cfg;
  }

  /** Swap configs (weapon switch / pickup): heat/charge/burst/cooldown and
   *  the queued edge reset; the rng stream (and its draw position) survives. */
  setConfig(id: WeaponId): void {
    this.cfg = WEAPON_CONFIGS[id];
    this.cooldown = 0;
    this.heat = 0;
    this.chargeT = 0;
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.queued = false;
  }

  /** Trigger level, sampled once per physics tick by the caller. */
  setTriggerHeld(held: boolean): void {
    this.held = held;
  }

  heat01(): number {
    return this.cfg.heatMax > 0 ? this.heat / this.cfg.heatMax : 0;
  }

  charge01(): number {
    return this.cfg.chargeS > 0 ? this.chargeT / this.cfg.chargeS : 0;
  }

  cooldown01(): number {
    return this.cfg.cooldownS > 0 ? this.cooldown / this.cfg.cooldownS : 0;
  }

  /** Called from the input action edge (any thread-of-control). No-op on
   *  charge configs — those fire on trigger release, not on the edge. */
  requestFire(): void {
    if (this.cfg.chargeS > 0) return;
    this.queued = true;
  }

  /** Snapshot the sim-relevant state so a replay can re-simulate shots
   *  bit-exactly from this point (config included — a killcam recorded
   *  mid-burst restores the right weapon). */
  serialize(): WeaponState {
    return {
      cooldown: this.cooldown,
      heat: this.heat,
      rngState: this.rng.getState(),
      configId: this.cfg.id,
      chargeT: this.chargeT,
      burstLeft: this.burstLeft,
      burstTimer: this.burstTimer,
    };
  }

  restore(s: WeaponState): void {
    this.cfg = WEAPON_CONFIGS[s.configId] ?? WEAPON_CONFIGS.blaster;
    this.cooldown = s.cooldown;
    this.heat = s.heat;
    this.chargeT = s.chargeT;
    this.burstLeft = s.burstLeft;
    this.burstTimer = s.burstTimer;
    this.queued = false;
    this.held = false;
    this.rng.setState(s.rngState);
  }

  /** Advance cooldown/heat/burst/charge; resolve a shot when one is due.
   *  Returns the shot result or null. Call once per physics tick. */
  tick(
    dt: number,
    dronePos: THREE.Vector3,
    droneQuat: THREE.Quaternion,
    world: CollisionWorld | undefined,
    targets: readonly ShotTarget[],
  ): ShotResult | null {
    const cfg = this.cfg;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.heat = Math.max(0, this.heat - cfg.heatCoolRate * dt);

    // Mid-burst: one round per burstIntervalS until the burst completes;
    // a fresh trigger during the burst is ignored.
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstLeft--;
        this.burstTimer += cfg.burstIntervalS;
        if (this.burstLeft === 0) this.cooldown = cfg.cooldownS; // post-burst pause
        return this.fire(dronePos, droneQuat, world, targets);
      }
      return null;
    }

    if (cfg.chargeS > 0) {
      // Charge weapon: hold to charge, release at full charge to fire.
      // Early release fizzles (charge resets); no charging during cooldown.
      if (this.held) {
        if (this.cooldown <= 0) this.chargeT = Math.min(cfg.chargeS, this.chargeT + dt);
        return null;
      }
      if (this.chargeT > 0) {
        const full = this.chargeT >= cfg.chargeS - 1e-9;
        this.chargeT = 0;
        if (full && this.cooldown <= 0) {
          this.cooldown = cfg.cooldownS;
          return this.fire(dronePos, droneQuat, world, targets);
        }
      }
      return null;
    }

    // Instant configs: the action edge queues one request; holding the
    // trigger re-requests every tick (auto-fire).
    let wantFire = this.held;
    if (this.queued) {
      this.queued = false;
      wantFire = true;
    }
    if (!wantFire || this.cooldown > 0) return null;

    if (cfg.burstCount > 1) {
      this.burstLeft = cfg.burstCount - 1;
      this.burstTimer = cfg.burstIntervalS;
    } else {
      this.cooldown = cfg.cooldownS;
    }
    return this.fire(dronePos, droneQuat, world, targets);
  }

  /** Resolve one hitscan shot along body-forward with heat spread. */
  private fire(
    dronePos: THREE.Vector3,
    droneQuat: THREE.Quaternion,
    world: CollisionWorld | undefined,
    targets: readonly ShotTarget[],
  ): ShotResult {
    const cfg = this.cfg;
    _dir.set(0, 0, -1).applyQuaternion(droneQuat);
    // spread: deterministic random offset in the aim plane, grows with heat
    const spread = this.heat * cfg.spreadPerHeat;
    this.heat = Math.min(cfg.heatMax, this.heat + cfg.heatPerShot);
    if (spread > 0) {
      _right.set(1, 0, 0).applyQuaternion(droneQuat);
      _up.set(0, 1, 0).applyQuaternion(droneQuat);
      const a = this.rng() * Math.PI * 2;
      const r = this.rng() * spread;
      _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
    }
    _from.copy(dronePos).addScaledVector(_dir, 0.15); // just past the props
    _to.copy(_from).addScaledVector(_dir, WEAPON_RANGE);

    // world blocking distance
    let worldDist = Infinity;
    if (world?.sweep) {
      const hit = world.sweep(_from, _to);
      if (hit) worldDist = hit.point.distanceTo(_from);
    }

    // nearest target sphere along the ray, closer than the world hit
    let bestIdx: number | null = null;
    let bestDist = worldDist;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t.alive) continue;
      _rel.subVectors(t.pos, _from);
      const along = _rel.dot(_dir);
      if (along < 0 || along > bestDist) continue;
      const perpSq = _rel.lengthSq() - along * along;
      if (perpSq <= t.radius * t.radius) {
        bestDist = along;
        bestIdx = i;
      }
    }

    const dist = Math.min(bestDist, WEAPON_RANGE);
    return {
      from: _from.clone(),
      to: _from.clone().addScaledVector(_dir, dist),
      targetIndex: bestIdx,
      hitWorld: bestIdx === null && worldDist < WEAPON_RANGE,
      damage: cfg.damage,
    };
  }
}
