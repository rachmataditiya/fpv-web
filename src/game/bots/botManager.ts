/** Enemy bot orchestrator — owns the squad (default: rifleman/sniper/heavy
 *  soldiers + scout/rifleman drones), their meshes, spawning and respawn
 *  timers, the heavy's projectile pool, squad alert + scout shared intel, and
 *  drives each bot's brain from the physics tick.
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
import { mulberry32Stateful } from '../rng';
import type { StatefulRng } from '../rng';
import { samplePoint } from './placement';
import { stepDrone, stepSoldier } from './botBrain';
import type { BotEnv } from './botBrain';
import { applyDifficulty } from './difficulty';
import { distToSegment } from './perception';
import { ProjectilePool } from '../projectiles';
import { CLASS_TUNING, DEFAULT_SQUAD, PLAYER_SHOT_DAMAGE, PLAYER_TARGET_RADIUS, TUNING } from './types';
import type { Bot, BotAiState, BotClass, BotCtx, BotDiedEvent, BotEvent, BotTuning, DroneTuning, SoldierTuning, SquadMember } from './types';

export { PLAYER_SHOT_DAMAGE };

/** Flat per-bot snapshot row (serialize/restore):
 *  [0]  kindIdx      0=drone, 1=soldier
 *  [1]  alive        0/1
 *  [2]  hp
 *  [3..5]   pos xyz
 *  [6..8]   vel xyz
 *  [9]  yaw
 *  [10] stateIdx     0=patrol, 1=alert, 2=engage, 3=seek, 4=dead
 *  [11] stateTime
 *  [12] trackTime
 *  [13] reactionLeft
 *  [14] burstLeft
 *  [15] fireCooldown
 *  [16] hasWaypoint  0/1
 *  [17..19] waypoint xyz
 *  [20] wpTime
 *  [21] hasLastKnown 0/1
 *  [22..24] lastKnown xyz
 *  [25] walkPhase
 *  [26] respawnIn
 *  [27] rngState     bot stream position before the next draw
 *  [28] classIdx     0=rifleman, 1=sniper, 2=heavy, 3=scout
 *  [29] chargeLeft
 *  [30] suppressLeft
 *  Squad intel lives on the manager (mark row below) — tune/tuneSuppressed are
 *  construction-derived and intentionally NOT snapshotted. */
export interface BotsSnapshot {
  kills: number;
  rngState: number;
  bots: number[][];
  /** [simTime, markUntil, markedPos xyz, markFrom xyz] — scout shared intel,
   *  carried so a mid-mark snapshot restores bit-exact squad behavior. */
  mark: number[];
  /** Projectile pool slots: [alive, pos xyz, vel xyz, ttl] each — a heavy's
   *  rocket in flight across a snapshot must survive the restore too. */
  projs: number[][];
}

const STATE_IDX: Record<BotAiState, number> = { patrol: 0, alert: 1, engage: 2, seek: 3, dead: 4 };
const STATE_BY_IDX: readonly BotAiState[] = ['patrol', 'alert', 'engage', 'seek', 'dead'];
const CLASS_IDX: Record<BotClass, number> = { rifleman: 0, sniper: 1, heavy: 2, scout: 3 };
const CLASS_BY_IDX: readonly BotClass[] = ['rifleman', 'sniper', 'heavy', 'scout'];

/** Bots never (re)spawn closer to the player spawn than this. */
const SPAWN_CLEARANCE = 20;
const BOT_SEPARATION = 8;
/** Patrol waypoints only need to clear the immediate spawn area. */
const WAYPOINT_CLEARANCE = 8;
/** Death anim durations (render-side; respawn timing is untouched). */
const SOLDIER_CRUMPLE_S = 0.7;
const DRONE_TUMBLE_S = 0.8;
/** Squad alert radius: a teammate engaging wakes patrolling bots this close. */
const SQUAD_ALERT_RADIUS = 25;
/** Scout intel: who gets alerted (from the mark origin) and for how long. */
const MARK_ALERT_RADIUS = 40;
const MARK_DURATION_S = 3;
/** Suppression window from a player shot passing close by. */
const SUPPRESS_RADIUS = 2;
const SUPPRESS_S = 1.5;
/** Heavy rocket blast damage — fixed, matches CLASS_TUNING.heavy.damage
 *  (difficulty scaling applies to the tune, the blast const stays simple). */
const HEAVY_BLAST_DAMAGE = 22;

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
  /** The heavy squad member's rockets — sim-side pool, render reads list. */
  readonly projectiles: ProjectilePool;
  kills = 0;
  /** Track editor open etc. — AI goes idle (respawn timers keep running). */
  passive = false;
  /** main.ts spawns ragdolls for dead soldiers — skip the built-in crumple. */
  externalSoldierCorpses = false;

  private bots: Bot[] = [];
  /** Parallel to bots: soldier pose driver (null for drones). */
  private posers: (((walkPhase: number, aimPitch: number) => void) | null)[] = [];
  /** Parallel to bots: soldier crumple driver (null for drones). */
  private downers: (((t: number) => void) | null)[] = [];
  private deathAnims: (DeathAnim | null)[] = [];
  /** Sniper aim telegraphs — thin red laser from muzzle to player. */
  private lasers: THREE.Line[] = [];
  private fx: FxSystem | null;
  private rng: StatefulRng;
  private world: CollisionWorld;
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private avoid: THREE.Vector3;
  private strictFloor: ((x: number, z: number) => number | null) | null;
  private env: BotEnv;
  private events: BotEvent[] = [];
  /** Sim clock (s) — scout intel windows key off this. */
  private simTime = 0;
  /** Active scout mark: squad converges on markedPos until markUntil. */
  private markUntil = 0;
  private markedPos = new THREE.Vector3();
  private markFrom = new THREE.Vector3();

  /** extraSpawns: the map's unused info_player_* points (bsp.spawns[1..]) —
   *  consumed for initial placement before falling back to sampling. */
  constructor(
    world: CollisionWorld,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    avoid: THREE.Vector3,
    strictFloor: ((x: number, z: number) => number | null) | null = null,
    extraSpawns: { pos: [number, number, number]; yawDeg: number }[] = [],
    squad: SquadMember[] = DEFAULT_SQUAD,
    seed = 4242,
    opts: { difficulty?: BotDifficulty; fx?: FxSystem | null } = {},
  ) {
    this.world = world;
    this.bounds = bounds;
    this.avoid = avoid.clone();
    this.strictFloor = strictFloor;
    this.fx = opts.fx ?? null;
    const difficulty = opts.difficulty ?? 'normal';
    this.projectiles = new ProjectilePool(world);
    this.rng = mulberry32Stateful(seed);
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
      spawnProjectile: (from, dir, speed, spreadRad, rng) =>
        this.projectiles.spawn(from, dir, speed, spreadRad, rng),
    };

    // sniper telegraph lasers (render-side; updateVisuals drives them)
    for (let i = 0; i < 4; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: 0xff2020,
          blending: THREE.AdditiveBlending,
          transparent: true,
          opacity: 0.7,
        }),
      );
      line.visible = false;
      line.frustumCulled = false; // endpoints move every frame
      this.group.add(line);
      this.lasers.push(line);
    }

    const fixedSpawns = [...extraSpawns];
    const make = (member: SquadMember, index: number): void => {
      const kind = member.kind;
      // class tuning: rifleman = the kind base block, others = CLASS_TUNING
      const base = member.cls === 'rifleman' ? TUNING[kind] : CLASS_TUNING[member.cls];
      const tune: BotTuning = applyDifficulty(base, difficulty);
      // preallocated suppression copy — the same tune with a ×1.5 aim cone
      const tuneSuppressed: BotTuning = { ...tune };
      tuneSuppressed.aimErrBase = tune.aimErrBase * 1.5;
      tuneSuppressed.aimErrMin = tune.aimErrMin * 1.5;
      tuneSuppressed.aimErrPerMeter = tune.aimErrPerMeter * 1.5;
      tuneSuppressed.aimErrPerSpeed = tune.aimErrPerSpeed * 1.5;
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
        botClass: member.cls,
        pos: new THREE.Vector3(),
        radius: tune.hitRadius,
        alive: false,
        hp: tune.hp,
        state: 'patrol',
        tune,
        tuneSuppressed,
        chargeLeft: 0,
        suppressLeft: 0,
        vel: new THREE.Vector3(),
        yaw: 0,
        respawnIn: 0,
        mesh,
        rng: mulberry32Stateful(seed + 101 * (index + 1)),
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
    squad.forEach((member, i) => make(member, i));
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
    this.kills++;
    return this.killBot(i);
  }

  /** Weather coupling: scale every bot's senses live. Factors multiply the
   *  CLASS_TUNING base values (difficulty never touches senses, so the base
   *  is authoritative) — dust storms blind snipers, night sharpens ears. */
  setWeather(visFactor: number, hearFactor: number): void {
    for (const b of this.bots) {
      // rifleman = the kind base block, others = CLASS_TUNING (same as make())
      const base = b.botClass === 'rifleman' ? TUNING[b.kind] : CLASS_TUNING[b.botClass];
      b.tune.visionRange = base.visionRange * visFactor;
      b.tune.hearRange = base.hearRange * hearFactor;
      b.tune.rotorHearRange = base.rotorHearRange * hearFactor;
      b.tuneSuppressed.visionRange = b.tune.visionRange;
      b.tuneSuppressed.hearRange = b.tune.hearRange;
      b.tuneSuppressed.rotorHearRange = b.tune.rotorHearRange;
    }
  }

  /** Area damage (barrel blast): every living bot inside `radius` of `pos`
   *  takes `damage`. Returns the death events — kills count for the player
   *  (they lit the barrel). */
  blast(pos: THREE.Vector3, radius: number, damage: number): BotDiedEvent[] {
    const died: BotDiedEvent[] = [];
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (!b.alive || b.pos.distanceTo(pos) > radius) continue;
      const d = this.hit(i, damage);
      if (d) died.push(d);
    }
    return died;
  }

  /** Blast damage to every living bot within `radius` of `pos` (heavy rocket
   *  friendly fire — enemy-inflicted, so NO kills++). Returns the deaths. */
  areaDamage(pos: THREE.Vector3, radius: number, damage: number): BotDiedEvent[] {
    const died: BotDiedEvent[] = [];
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (!b.alive || b.pos.distanceTo(pos) > radius) continue;
      b.hp -= damage;
      if (b.hp > 0) continue;
      died.push(this.killBot(i));
    }
    return died;
  }

  /** Shared death path (hit + areaDamage): state, respawn timer, death anim,
   *  and the one-time event. Scorekeeping (kills++) is the caller's job. */
  private killBot(i: number): BotDiedEvent {
    const b = this.bots[i];
    b.alive = false;
    b.state = 'dead';
    b.respawnIn = b.tune.respawnS;
    if (b.kind === 'soldier' && this.externalSoldierCorpses) {
      // a ragdoll takes over the corpse — hide instantly, skip the crumple
      b.mesh.visible = false;
      this.deathAnims[i] = null;
      return { type: 'bot-died', kind: b.kind, cls: b.botClass, pos: b.pos };
    }
    this.deathAnims[i] = {
      t: 0,
      from: b.pos.clone(),
      driftX: b.vel.x * 0.4,
      driftZ: b.vel.z * 0.4,
      spinX: 5.5 + Math.abs(b.yaw % 1.5),
      spinZ: -(4 + Math.abs(b.yaw % 1.2)),
      smoked: 0,
    };
    return { type: 'bot-died', kind: b.kind, cls: b.botClass, pos: b.pos };
  }

  /** Player shot segment (from→to) just resolved — soldiers it passed within
   *  SUPPRESS_RADIUS of get suppression: a ×1.5 aim cone for SUPPRESS_S. */
  suppressNear(from: THREE.Vector3, to: THREE.Vector3): void {
    for (const b of this.bots) {
      if (!b.alive || b.kind !== 'soldier') continue;
      if (distToSegment(b.pos, from, to) <= SUPPRESS_RADIUS) b.suppressLeft = SUPPRESS_S;
    }
  }

  /** Full sim-state snapshot (see BotsSnapshot for the row layout) — replay
   *  re-simulation restores this and draws identical rng sequences from here. */
  serialize(): BotsSnapshot {
    return {
      kills: this.kills,
      rngState: this.rng.getState(),
      bots: this.bots.map((b) => [
        b.kind === 'drone' ? 0 : 1,
        b.alive ? 1 : 0,
        b.hp,
        b.pos.x, b.pos.y, b.pos.z,
        b.vel.x, b.vel.y, b.vel.z,
        b.yaw,
        STATE_IDX[b.state],
        b.stateTime,
        b.trackTime,
        b.reactionLeft,
        b.burstLeft,
        b.fireCooldown,
        b.waypoint ? 1 : 0,
        b.waypoint?.x ?? 0, b.waypoint?.y ?? 0, b.waypoint?.z ?? 0,
        b.wpTime,
        b.lastKnown ? 1 : 0,
        b.lastKnown?.x ?? 0, b.lastKnown?.y ?? 0, b.lastKnown?.z ?? 0,
        b.walkPhase,
        b.respawnIn,
        b.rng.getState(),
        CLASS_IDX[b.botClass],
        b.chargeLeft,
        b.suppressLeft,
      ]),
      mark: [
        this.simTime,
        this.markUntil,
        this.markedPos.x, this.markedPos.y, this.markedPos.z,
        this.markFrom.x, this.markFrom.y, this.markFrom.z,
      ],
      projs: this.projectiles.list.map((p) => [
        p.alive ? 1 : 0,
        p.pos.x, p.pos.y, p.pos.z,
        p.vel.x, p.vel.y, p.vel.z,
        p.ttl,
      ]),
    };
  }

  /** Overwrite all sim state from a snapshot. Precondition: this manager was
   *  constructed with the same squad + seed as the snapshotted one (same bot
   *  count/order). Draws NOTHING from any rng — construction-time draws are
   *  fully overwritten, including every stream's state. */
  restore(s: BotsSnapshot): void {
    this.kills = s.kills;
    this.rng.setState(s.rngState);
    this.simTime = s.mark[0];
    this.markUntil = s.mark[1];
    this.markedPos.set(s.mark[2], s.mark[3], s.mark[4]);
    this.markFrom.set(s.mark[5], s.mark[6], s.mark[7]);
    for (let i = 0; i < this.projectiles.list.length; i++) {
      const p = this.projectiles.list[i];
      const r = s.projs[i];
      p.alive = r[0] !== 0;
      p.pos.set(r[1], r[2], r[3]);
      p.vel.set(r[4], r[5], r[6]);
      p.ttl = r[7];
    }
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      const r = s.bots[i];
      b.alive = r[1] !== 0;
      b.hp = r[2];
      b.pos.set(r[3], r[4], r[5]);
      b.vel.set(r[6], r[7], r[8]);
      b.yaw = r[9];
      b.state = STATE_BY_IDX[r[10]] ?? 'patrol';
      b.stateTime = r[11];
      b.trackTime = r[12];
      b.reactionLeft = r[13];
      b.burstLeft = r[14];
      b.fireCooldown = r[15];
      if (r[16] !== 0) {
        b.waypoint = (b.waypoint ?? new THREE.Vector3()).set(r[17], r[18], r[19]);
      } else {
        b.waypoint = null;
      }
      b.wpTime = r[20];
      if (r[21] !== 0) {
        b.lastKnown = (b.lastKnown ?? new THREE.Vector3()).set(r[22], r[23], r[24]);
      } else {
        b.lastKnown = null;
      }
      b.walkPhase = r[25];
      b.respawnIn = r[26];
      b.rng.setState(r[27]);
      b.botClass = CLASS_BY_IDX[r[28]] ?? 'rifleman';
      b.chargeLeft = r[29];
      b.suppressLeft = r[30];
      // render-side cleanup: no dying meshes carried over from construction
      this.deathAnims[i] = null;
      this.downers[i]?.(0); // stand soldier meshes back up
      b.mesh.visible = b.alive;
      b.mesh.rotation.x = 0;
      b.mesh.rotation.z = 0;
    }
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

  /** AI + respawn timers + projectiles. Call once per physics tick; returned
   *  events are valid until the next tick() (the array is reused). */
  tick(dt: number, ctx: BotCtx): readonly BotEvent[] {
    this.events.length = 0;
    this.simTime += dt;
    for (const b of this.bots) {
      if (!b.alive) {
        b.respawnIn -= dt;
        if (b.respawnIn <= 0) this.place(b); // respawn always at a fresh sampled spot
        continue;
      }
      if (this.passive) continue;
      const before = b.state;
      if (b.kind === 'soldier') stepSoldier(b, ctx, this.env, dt, this.events);
      else stepDrone(b, ctx, this.env, dt, this.events);
      // squad alert: one bot engaging wakes patrolling teammates in earshot
      if (before !== 'engage' && b.state === 'engage') {
        for (const o of this.bots) {
          if (o === b || !o.alive || o.state !== 'patrol') continue;
          if (o.pos.distanceTo(b.pos) > SQUAD_ALERT_RADIUS) continue;
          o.state = 'alert';
          o.stateTime = 0;
          o.reactionLeft = o.tune.reactionS;
          o.lastKnown = (o.lastKnown ?? new THREE.Vector3()).copy(ctx.playerPos);
        }
      }
    }
    // scout shared intel: a fresh mark re-opens the 3s convergence window
    for (const ev of this.events) {
      if (ev.type !== 'bot-mark') continue;
      this.markUntil = this.simTime + MARK_DURATION_S;
      this.markedPos.copy(ev.pos);
      this.markFrom.copy(ev.from);
    }
    if (this.simTime < this.markUntil) {
      for (const o of this.bots) {
        if (!o.alive || o.botClass === 'scout') continue;
        if (o.state === 'patrol') {
          if (o.pos.distanceTo(this.markFrom) > MARK_ALERT_RADIUS) continue;
          o.state = 'alert';
          o.stateTime = 0;
          o.reactionLeft = o.tune.reactionS;
          o.lastKnown = (o.lastKnown ?? new THREE.Vector3()).copy(this.markedPos);
        } else {
          // already hunting — keep the target fresh
          o.lastKnown = (o.lastKnown ?? new THREE.Vector3()).copy(this.markedPos);
        }
      }
    }
    // heavy rockets: blasts hurt the player (main.ts) AND bots (friendly fire)
    const blasts = this.projectiles.tick(dt, {
      pos: ctx.playerPos,
      radius: PLAYER_TARGET_RADIUS,
      alive: ctx.playerAlive,
    });
    for (const bl of blasts) {
      this.events.push({ type: 'projectile-blast', pos: bl.pos, damage: HEAVY_BLAST_DAMAGE });
      for (const d of this.areaDamage(bl.pos, this.projectiles.radius, HEAVY_BLAST_DAMAGE)) {
        this.events.push(d);
      }
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
    // sniper telegraph lasers: muzzle → player while the charge window runs
    let li = 0;
    for (const b of this.bots) {
      if (li >= this.lasers.length) break;
      if (!b.alive || b.chargeLeft <= 0 || b.kind !== 'soldier') continue;
      const line = this.lasers[li++];
      const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const muzzleY = b.pos.y - SOLDIER_HEIGHT / 2 + (b.tune as SoldierTuning).muzzleHeight;
      attr.setXYZ(0, b.pos.x, muzzleY, b.pos.z);
      attr.setXYZ(1, playerPos.x, playerPos.y, playerPos.z);
      attr.needsUpdate = true;
      line.visible = true;
    }
    for (; li < this.lasers.length; li++) this.lasers[li].visible = false;
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
      preferHigh: b.botClass === 'sniper', // snipers take the perch
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
