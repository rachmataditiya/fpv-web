/** Enemy bot orchestrator — owns the bot list, their meshes, spawning and
 *  respawn timers, and drives each bot's brain from the physics tick.
 *  Soldiers run the full patrol/alert/engage/seek machine (botBrain); drones
 *  are still hovering dummies until B1.6.
 *
 *  Sim/render split: tick() runs at 240 Hz from simTick and never touches
 *  meshes except through placeAt (like BarrelField); updateVisuals() runs from
 *  renderTick only. Deterministic: seeded manager rng for placement plus one
 *  seeded stream per bot for aim error. */
import * as THREE from 'three';
import { createDroneMesh } from '../../render/drone';
import { createSoldierMesh, SOLDIER_HEIGHT } from '../../render/soldierMesh';
import type { FxSystem } from '../../render/fx';
import type { CollisionWorld } from '../../physics/quad';
import type { ShotTarget } from '../weapon';
import type { BotDifficulty } from '../../state';
import { mulberry32 } from '../rng';
import { samplePoint } from './placement';
import { stepDrone, stepSoldier } from './botBrain';
import type { BotEnv } from './botBrain';
import { applyDifficulty } from './difficulty';
import { PLAYER_SHOT_DAMAGE, TUNING } from './types';
import type { Bot, BotCtx, BotDiedEvent, BotEvent, BotKind, DroneTuning, SoldierTuning } from './types';

export { PLAYER_SHOT_DAMAGE };

/** Bots never (re)spawn closer to the player spawn than this. */
const SPAWN_CLEARANCE = 20;
const BOT_SEPARATION = 8;
/** Patrol waypoints only need to clear the immediate spawn area. */
const WAYPOINT_CLEARANCE = 8;
/** Death anim durations (render-side; respawn timing is untouched). */
const SOLDIER_CRUMPLE_S = 0.7;
const DRONE_TUMBLE_S = 0.8;

const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/** Enemy drone visual scale (player quad is ~0.37m across; ×3 ≈ 1.1m span).
 *  TUNING.drone.hitRadius and botBrain's wall clearance are sized to match. */
const DRONE_SCALE = 3;

/** Render-side death animation state, parallel to bots (null = not dying). */
interface DeathAnim {
  t: number; // 0..1
  from: THREE.Vector3;
  driftX: number;
  driftZ: number;
  spinX: number;
  spinZ: number;
  smoked: number; // bitmask of smoke puffs already emitted
}

export class BotManager {
  readonly group = new THREE.Group();
  kills = 0;
  /** Track editor open etc. — AI goes idle (respawn timers keep running). */
  passive = false;

  private bots: Bot[] = [];
  /** Parallel to bots: soldier pose driver (null for drones). */
  private posers: (((walkPhase: number, aimPitch: number) => void) | null)[] = [];
  /** Parallel to bots: soldier crumple driver (null for drones). */
  private downers: (((t: number) => void) | null)[] = [];
  private deathAnims: (DeathAnim | null)[] = [];
  private tuning: { drone: DroneTuning; soldier: SoldierTuning };
  private fx: FxSystem | null;
  private rng: () => number;
  private world: CollisionWorld;
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private avoid: THREE.Vector3;
  private strictFloor: ((x: number, z: number) => number | null) | null;
  private env: BotEnv;
  private events: BotEvent[] = [];

  /** extraSpawns: the map's unused info_player_* points (bsp.spawns[1..]) —
   *  consumed for initial placement before falling back to sampling. */
  constructor(
    world: CollisionWorld,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    avoid: THREE.Vector3,
    strictFloor: ((x: number, z: number) => number | null) | null = null,
    extraSpawns: { pos: [number, number, number]; yawDeg: number }[] = [],
    counts: { drones: number; soldiers: number } = { drones: 2, soldiers: 3 },
    seed = 4242,
    opts: { difficulty?: BotDifficulty; fx?: FxSystem | null } = {},
  ) {
    this.world = world;
    this.bounds = bounds;
    this.avoid = avoid.clone();
    this.strictFloor = strictFloor;
    this.fx = opts.fx ?? null;
    this.tuning = {
      drone: applyDifficulty(TUNING.drone, opts.difficulty ?? 'normal'),
      soldier: applyDifficulty(TUNING.soldier, opts.difficulty ?? 'normal'),
    };
    this.rng = mulberry32(seed);
    this.group.name = 'bots';
    this.env = {
      world,
      // Strict floor with seam tolerance: the single-ray sampler slips through
      // cracks between BSP brushes and reports null MID-MAP, which froze
      // drones dead ("off the footprint edge") while hovering over a seam.
      floorAt: (x, z) => {
        const s = this.strictFloor;
        if (!s) return this.world.floorAt(x, 200, z);
        const c = s(x, z);
        if (c !== null) return c;
        for (const [dx, dz] of [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) {
          const t = s(x + dx, z + dz);
          if (t !== null) return t;
        }
        return null; // genuinely off the map footprint
      },
      sampleWaypoint: () =>
        samplePoint({
          world: this.world,
          bounds: this.bounds,
          strictFloor: this.strictFloor,
          avoid: this.avoid,
          avoidRadius: WAYPOINT_CLEARANCE,
          others: [],
          minSeparation: 0,
          footRadius: 0.4,
          clearance: SOLDIER_HEIGHT + 0.4,
          rng: this.rng,
        }),
    };

    const fixedSpawns = [...extraSpawns];
    const make = (kind: BotKind, index: number): void => {
      const tune = this.tuning[kind];
      let mesh: THREE.Group;
      let poser: ((walkPhase: number, aimPitch: number) => void) | null = null;
      let downer: ((t: number) => void) | null = null;
      if (kind === 'drone') {
        mesh = createDroneMesh({ accent: 0xff2222 });
        mesh.scale.setScalar(DRONE_SCALE); // heavy interceptor read, not a gnat
      } else {
        const s = createSoldierMesh();
        mesh = s.group;
        poser = s.setPose;
        downer = s.setDown;
      }
      const b: Bot = {
        kind,
        pos: new THREE.Vector3(),
        radius: tune.hitRadius,
        alive: false,
        hp: tune.hp,
        state: 'patrol',
        tune,
        vel: new THREE.Vector3(),
        yaw: 0,
        respawnIn: 0,
        mesh,
        rng: mulberry32(seed + 101 * (index + 1)),
        stateTime: 0,
        trackTime: 0,
        reactionLeft: 0,
        burstLeft: 0,
        fireCooldown: 0,
        waypoint: null,
        wpTime: 0,
        lastKnown: null,
        walkPhase: 0,
      };
      mesh.visible = false;
      this.group.add(mesh);
      this.bots.push(b);
      this.posers.push(poser);
      this.downers.push(downer);
      this.deathAnims.push(null);
      this.place(b, fixedSpawns);
    };
    let idx = 0;
    for (let i = 0; i < counts.drones; i++) make('drone', idx++);
    for (let i = 0; i < counts.soldiers; i++) make('soldier', idx++);
  }

  get targets(): readonly ShotTarget[] {
    return this.bots;
  }

  aliveCount(): number {
    return this.bots.reduce((n, b) => n + (b.alive ? 1 : 0), 0);
  }

  /** Player hit bot i for `damage`. Returns the death event once, when the hit
   *  kills — the caller drives FX/score off it (mirrors BarrelField.explode).
   *  The mesh stays visible: updateVisuals runs the death crumple/tumble. */
  hit(i: number, damage: number): BotDiedEvent | null {
    const b = this.bots[i];
    if (!b.alive) return null;
    b.hp -= damage;
    if (b.hp > 0) return null;
    b.alive = false;
    b.state = 'dead';
    b.respawnIn = b.tune.respawnS;
    this.kills++;
    this.deathAnims[i] = {
      t: 0,
      from: b.pos.clone(),
      driftX: b.vel.x * 0.4,
      driftZ: b.vel.z * 0.4,
      spinX: 5.5 + Math.abs(b.yaw % 1.5),
      spinZ: -(4 + Math.abs(b.yaw % 1.2)),
      smoked: 0,
    };
    return { type: 'bot-died', kind: b.kind, pos: b.pos };
  }

  /** Distance to the nearest living drone bot (Infinity when none) — the
   *  rotor-whirr ping in main.ts keys off this. */
  nearestAliveDroneDist(pos: THREE.Vector3): number {
    let best = Infinity;
    for (const b of this.bots) {
      if (b.alive && b.kind === 'drone') best = Math.min(best, b.pos.distanceTo(pos));
    }
    return best;
  }

  /** AI + respawn timers. Call once per physics tick; returned events are
   *  valid until the next tick() (the array is reused). */
  tick(dt: number, ctx: BotCtx): readonly BotEvent[] {
    this.events.length = 0;
    for (const b of this.bots) {
      if (!b.alive) {
        b.respawnIn -= dt;
        if (b.respawnIn <= 0) this.place(b); // respawn always at a fresh sampled spot
        continue;
      }
      if (this.passive) continue;
      if (b.kind === 'soldier') stepSoldier(b, ctx, this.env, dt, this.events);
      else stepDrone(b, ctx, this.env, dt, this.events);
    }
    return this.events;
  }

  /** Render-frame mesh dressing only — never called from the sim tick. Dead
   *  bots run their death anim here (soldier crumple / drone tumble+smoke);
   *  sim respawn timing is untouched. */
  updateVisuals(frameDt: number, playerPos: THREE.Vector3): void {
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (!b.alive) {
        const anim = this.deathAnims[i];
        if (!anim) continue;
        if (b.kind === 'soldier') {
          // crumple in place, then lie there until just before the respawn
          anim.t = Math.min(1, anim.t + frameDt / SOLDIER_CRUMPLE_S);
          const feetY = anim.from.y - SOLDIER_HEIGHT / 2;
          b.mesh.position.set(anim.from.x, feetY, anim.from.z);
          b.mesh.rotation.y = b.yaw;
          this.downers[i]?.(anim.t);
          if (b.respawnIn <= 1.2) {
            b.mesh.visible = false;
            this.deathAnims[i] = null;
          }
        } else {
          // dead drone: tumble + drop with smoke, then gone
          anim.t += frameDt / DRONE_TUMBLE_S;
          const ft = anim.t * DRONE_TUMBLE_S;
          b.mesh.position.set(
            anim.from.x + anim.driftX * ft,
            anim.from.y - 4.9 * ft * ft,
            anim.from.z + anim.driftZ * ft,
          );
          b.mesh.rotation.x += anim.spinX * frameDt;
          b.mesh.rotation.z += anim.spinZ * frameDt;
          if ((anim.smoked & 1) === 0) {
            anim.smoked |= 1;
            this.fx?.smoke(anim.from);
          }
          if (anim.t > 0.35 && (anim.smoked & 2) === 0) {
            anim.smoked |= 2;
            this.fx?.smoke(b.mesh.position);
          }
          if (anim.t >= 1) {
            b.mesh.visible = false;
            this.deathAnims[i] = null;
          }
        }
        continue;
      }
      if (b.kind === 'drone') {
        b.mesh.position.copy(b.pos);
        b.mesh.rotation.y = b.yaw;
        // bank into the motion a touch — reads as flying, not floating
        b.mesh.rotation.z = Math.max(-0.35, Math.min(0.35, -b.vel.dot(_right.set(-Math.cos(b.yaw), 0, Math.sin(b.yaw))) * 0.04));
        b.mesh.rotation.x = Math.max(-0.35, Math.min(0.35, -b.vel.dot(_fwd.set(-Math.sin(b.yaw), 0, -Math.cos(b.yaw))) * 0.04));
        continue;
      }
      const feetY = b.pos.y - SOLDIER_HEIGHT / 2;
      b.mesh.position.set(b.pos.x, feetY, b.pos.z);
      b.mesh.rotation.y = b.yaw;
      b.walkPhase += b.vel.length() * frameDt * 5.5;
      let aimPitch = 0;
      if (b.state === 'alert' || b.state === 'engage') {
        const muzzleH = (b.tune as SoldierTuning).muzzleHeight;
        const dy = playerPos.y - (feetY + muzzleH);
        aimPitch = Math.atan2(dy, Math.hypot(playerPos.x - b.pos.x, playerPos.z - b.pos.z));
      }
      this.posers[i]?.(b.walkPhase, aimPitch);
    }
  }

  /** Find a valid floor spot; keep the bot dead and retry soon if none found.
   *  fixedSpawns (initial placement only) are validated with the same rules. */
  private place(b: Bot, fixedSpawns?: { pos: [number, number, number]; yawDeg: number }[]): void {
    const clearance = b.kind === 'drone' ? (b.tune as DroneTuning).hoverAlt + 1 : SOLDIER_HEIGHT + 0.4;
    while (fixedSpawns && fixedSpawns.length) {
      const s = fixedSpawns.shift()!;
      const [x, , z] = s.pos;
      const y = this.strictFloor ? this.strictFloor(x, z) : this.world.floorAt(x, 200, z);
      if (y === null) continue;
      if ((x - this.avoid.x) ** 2 + (z - this.avoid.z) ** 2 < SPAWN_CLEARANCE ** 2) continue;
      if (this.bots.some((o) => o !== b && o.alive && (x - o.pos.x) ** 2 + (z - o.pos.z) ** 2 < BOT_SEPARATION ** 2)) continue;
      this.placeAt(b, x, y, z, (s.yawDeg * Math.PI) / 180);
      return;
    }
    const p = samplePoint({
      world: this.world,
      bounds: this.bounds,
      strictFloor: this.strictFloor,
      avoid: this.avoid,
      avoidRadius: SPAWN_CLEARANCE,
      others: this.bots.filter((o) => o !== b && o.alive).map((o) => o.pos),
      minSeparation: BOT_SEPARATION,
      footRadius: b.kind === 'drone' ? 0.5 : 0.4,
      clearance,
      rng: this.rng,
    });
    if (!p) {
      b.alive = false;
      b.mesh.visible = false;
      b.respawnIn = 2; // retry soon
      return;
    }
    this.placeAt(b, p.x, p.y, p.z, this.rng() * Math.PI * 2);
  }

  private placeAt(b: Bot, x: number, floorY: number, z: number, yaw: number): void {
    const tune = b.tune;
    if (b.kind === 'drone') {
      b.pos.set(x, floorY + (tune as DroneTuning).hoverAlt, z);
      b.mesh.position.copy(b.pos);
    } else {
      b.pos.set(x, floorY + SOLDIER_HEIGHT / 2, z); // hit sphere at chest height
      b.mesh.position.set(x, floorY, z);
    }
    b.hp = tune.hp;
    b.alive = true;
    b.state = 'patrol';
    b.stateTime = 0;
    b.trackTime = 0;
    b.reactionLeft = 0;
    b.burstLeft = 0;
    b.fireCooldown = 0;
    b.waypoint = null;
    b.wpTime = 0;
    b.lastKnown = null;
    b.vel.set(0, 0, 0);
    b.yaw = yaw;
    b.mesh.rotation.set(0, yaw, 0); // also clears any death tumble
    const idx = this.bots.indexOf(b);
    if (idx >= 0) {
      this.deathAnims[idx] = null;
      this.downers[idx]?.(0); // stand the soldier mesh back up
    }
    b.mesh.visible = true;
  }
}
