/** Enemy bot orchestrator — owns the bot list, their meshes, spawning and
 *  respawn timers. Phase A scope: static shootable dummies (2 hovering drones,
 *  3 standing soldiers); patrol/aim/fire AI lands with botBrain in B1.5/B1.6.
 *
 *  Sim/render split: tick() runs at 240 Hz from simTick and never touches
 *  meshes except through placeAt (like BarrelField); updateVisuals() runs from
 *  renderTick only. Deterministic: one seeded rng for all placement. */
import * as THREE from 'three';
import { createDroneMesh } from '../../render/drone';
import type { CollisionWorld } from '../../physics/quad';
import type { ShotTarget } from '../weapon';
import { mulberry32 } from '../rng';
import { samplePoint } from './placement';
import { PLAYER_SHOT_DAMAGE, TUNING } from './types';
import type { Bot, BotCtx, BotDiedEvent, BotKind } from './types';

export { PLAYER_SHOT_DAMAGE };

/** Bots never (re)spawn closer to the player spawn than this. */
const SPAWN_CLEARANCE = 20;
const BOT_SEPARATION = 8;
const SOLDIER_HEIGHT = 1.8;

function createSoldierPlaceholder(): THREE.Group {
  // Capsule stand-in until the articulated soldier mesh (B1.4). Origin at feet.
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3d5230, roughness: 0.8, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, SOLDIER_HEIGHT - 0.7, 4, 8), mat);
  body.position.y = SOLDIER_HEIGHT / 2;
  group.add(body);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.08, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 0.8 }),
  );
  visor.position.set(0, SOLDIER_HEIGHT - 0.35, -0.3);
  group.add(visor);
  return group;
}

export class BotManager {
  readonly group = new THREE.Group();
  kills = 0;
  /** Track editor open etc. — AI goes idle (respawn timers keep running). */
  passive = false;

  private bots: Bot[] = [];
  private rng: () => number;
  private world: CollisionWorld;
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private avoid: THREE.Vector3;
  private strictFloor: ((x: number, z: number) => number | null) | null;

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
  ) {
    this.world = world;
    this.bounds = bounds;
    this.avoid = avoid.clone();
    this.strictFloor = strictFloor;
    this.rng = mulberry32(seed);
    this.group.name = 'bots';

    const fixedSpawns = [...extraSpawns];
    const make = (kind: BotKind): void => {
      const mesh = kind === 'drone' ? createDroneMesh({ accent: 0xff2222 }) : createSoldierPlaceholder();
      if (kind === 'drone') mesh.scale.setScalar(1.6); // readable at range
      const b: Bot = {
        kind,
        pos: new THREE.Vector3(),
        radius: TUNING[kind].hitRadius,
        alive: false,
        hp: TUNING[kind].hp,
        state: 'patrol',
        vel: new THREE.Vector3(),
        yaw: 0,
        respawnIn: 0,
        mesh,
      };
      mesh.visible = false;
      this.group.add(mesh);
      this.bots.push(b);
      this.place(b, fixedSpawns);
    };
    for (let i = 0; i < counts.drones; i++) make('drone');
    for (let i = 0; i < counts.soldiers; i++) make('soldier');
  }

  get targets(): readonly ShotTarget[] {
    return this.bots;
  }

  aliveCount(): number {
    return this.bots.reduce((n, b) => n + (b.alive ? 1 : 0), 0);
  }

  /** Player hit bot i for `damage`. Returns the death event once, when the hit
   *  kills — the caller drives FX/score off it (mirrors BarrelField.explode). */
  hit(i: number, damage: number): BotDiedEvent | null {
    const b = this.bots[i];
    if (!b.alive) return null;
    b.hp -= damage;
    if (b.hp > 0) return null;
    b.alive = false;
    b.state = 'dead';
    b.mesh.visible = false;
    b.respawnIn = TUNING[b.kind].respawnS;
    this.kills++;
    return { type: 'bot-died', kind: b.kind, pos: b.pos };
  }

  /** Respawn timers (AI steps join here in B1.5). Call once per physics tick. */
  tick(dt: number, _ctx: BotCtx): void {
    for (const b of this.bots) {
      if (b.alive) continue;
      b.respawnIn -= dt;
      if (b.respawnIn <= 0) this.place(b); // respawn always at a fresh sampled spot
    }
  }

  /** Render-frame mesh dressing only — never called from the sim tick. */
  updateVisuals(_frameDt: number, playerPos: THREE.Vector3): void {
    for (const b of this.bots) {
      if (!b.alive) continue;
      // face the player (yaw only) so the dummies read as "watching you"
      b.yaw = Math.atan2(playerPos.x - b.pos.x, playerPos.z - b.pos.z) + Math.PI;
      b.mesh.rotation.y = b.yaw;
    }
  }

  /** Find a valid floor spot; keep the bot dead and retry soon if none found.
   *  fixedSpawns (initial placement only) are validated with the same rules. */
  private place(b: Bot, fixedSpawns?: { pos: [number, number, number]; yawDeg: number }[]): void {
    const clearance = b.kind === 'drone' ? TUNING.drone.hoverAlt + 1 : SOLDIER_HEIGHT + 0.4;
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
    const tune = TUNING[b.kind];
    if (b.kind === 'drone') {
      b.pos.set(x, floorY + TUNING.drone.hoverAlt, z);
      b.mesh.position.copy(b.pos);
    } else {
      b.pos.set(x, floorY + SOLDIER_HEIGHT / 2, z); // hit sphere at chest height
      b.mesh.position.set(x, floorY, z);
    }
    b.hp = tune.hp;
    b.alive = true;
    b.state = 'patrol';
    b.vel.set(0, 0, 0);
    b.yaw = yaw;
    b.mesh.rotation.y = yaw;
    b.mesh.visible = true;
  }
}
