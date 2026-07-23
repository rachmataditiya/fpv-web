/** Deterministic replay: the sim is a pure function of (snapshot state + input
 *  stream), so a replay is just data — record inputs + periodic full snapshots
 *  live, then re-simulate inside a sandbox that never touches live game state.
 *
 *  ReplayRecorder runs in the live simTick (ring buffer, zero per-tick alloc).
 *  ReplayPlayer rebuilds a fresh QuadState/Weapon/PlayerHealth/BotManager from
 *  a snapshot and steps the recorded stream with the SAME call order main.ts
 *  uses — bit-exact when the snapshot restore is faithful (see replay.test).
 *
 *  Killcam is the consumer: on player death, replay the last ~5s and watch it
 *  from the killer bot's POV. */
import * as THREE from 'three';
import { createQuadState, resetQuad, stepQuad } from '../physics/quad';
import type { CollisionWorld, QuadState } from '../physics/quad';
import type { QuadParams } from '../physics/params';
import type { FlightInput } from '../input/types';
import { Weapon } from './weapon';
import type { WeaponState } from './weapon';
import { TargetRegistry } from './targetRegistry';
import { PlayerHealth } from './playerHealth';
import { BotManager } from './bots/botManager';
import type { BotsSnapshot } from './bots/botManager';
import type { Bot, SoldierTuning } from './bots/types';
import { SOLDIER_HEIGHT } from '../render/soldierMesh';
import type { FxSystem } from '../render/fx';

/** One tick of flight command: roll/pitch/yaw rates, throttle, flags
 *  (bit0 = shootHeld). Stored raw (no quantization) in the ring. */
export interface TickInput {
  r: number;
  p: number;
  y: number;
  t: number;
  f: number;
}

export interface ActionRec {
  tick: number;
  action: 'arm' | 'respawn' | 'shoot';
}

export interface ReplayEvent {
  tick: number;
  type: string;
  data?: number[];
}

/** Flat copy of the sim-relevant QuadState fields (quad.ts). */
export interface QuadSnapshot {
  pos: number[];
  vel: number[];
  quat: number[];
  angVel: number[];
  thrust: number;
  armed: boolean;
  crashed: boolean;
  crashTimer: number;
}

/** Weapon.serialize() shape — config included (Wave 4), so a killcam recorded
 *  mid-burst/mid-charge restores the right weapon and shot timing. */
export type WeaponSnapshot = WeaponState;

export interface Snapshot {
  tick: number;
  quad: QuadSnapshot;
  hp: number;
  weapon: WeaponSnapshot;
  bots: BotsSnapshot | null;
}

export interface ReplayData {
  tickRate: 240;
  snapshotEvery: number;
  /** Absolute recorder tick of ticks[0] — actions/events/snapshots carry
   *  absolute ticks, so the ring-window offset travels with the data. */
  firstTick: number;
  ticks: TickInput[];
  actions: ActionRec[];
  events: ReplayEvent[];
  /** Oldest → newest. */
  snapshots: Snapshot[];
}

const MAX_EVENTS = 256;
const MAX_ACTIONS = 2048;

export class ReplayRecorder {
  /** Invoked at tick 0 and every snapshotEveryTicks to grab full sim state. */
  captureFn:
    | (() => { quad: QuadSnapshot; hp: number; weapon: WeaponSnapshot; bots: BotsSnapshot | null })
    | null = null;

  private readonly capacity: number;
  private readonly snapshotEvery: number;
  private readonly ring: TickInput[];
  private tickCount = 0; // absolute index of the NEXT tick to record
  private snapshots: Snapshot[] = [];
  private actions: ActionRec[] = [];
  private events: ReplayEvent[] = [];

  constructor(opts?: { capacityTicks?: number; snapshotEveryTicks?: number }) {
    this.capacity = opts?.capacityTicks ?? 7200; // 30s @ 240 Hz
    this.snapshotEvery = opts?.snapshotEveryTicks ?? 1200; // 5s
    this.ring = new Array<TickInput>(this.capacity);
    for (let i = 0; i < this.capacity; i++) this.ring[i] = { r: 0, p: 0, y: 0, t: 0, f: 0 };
  }

  /** Absolute index of the tick currently being sampled (== ticks recorded). */
  get tickIndex(): number {
    return this.tickCount;
  }

  /** Store one tick of input. Called from simTick AFTER input.sample() (so
   *  action edges already fired) and BEFORE stepQuad — a snapshot taken here
   *  captures the state that this tick's input is about to act on. */
  recordTick(cmd: FlightInput, shootHeld: boolean): void {
    const tick = this.tickCount;
    const slot = this.ring[tick % this.capacity];
    slot.r = cmd.rollRate;
    slot.p = cmd.pitchRate;
    slot.y = cmd.yawRate;
    slot.t = cmd.throttle;
    slot.f = shootHeld ? 1 : 0;
    this.tickCount++;
    if (tick % this.snapshotEvery === 0 && this.captureFn) {
      const c = this.captureFn();
      this.snapshots.push({ tick, quad: c.quad, hp: c.hp, weapon: c.weapon, bots: c.bots });
      const maxSnaps = Math.ceil(this.capacity / this.snapshotEvery) + 1;
      if (this.snapshots.length > maxSnaps) this.snapshots.splice(0, this.snapshots.length - maxSnaps);
    }
  }

  recordAction(action: 'arm' | 'respawn' | 'shoot'): void {
    this.actions.push({ tick: this.tickCount, action });
    if (this.actions.length > MAX_ACTIONS) this.actions.splice(0, this.actions.length - MAX_ACTIONS);
  }

  logEvent(type: string, data?: number[]): void {
    this.events.push({ tick: this.tickCount, type, data });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  /** In-memory copy, oldest → newest (killcam fast path). */
  data(): ReplayData {
    const first = Math.max(0, this.tickCount - this.capacity);
    const ticks: TickInput[] = [];
    for (let t = first; t < this.tickCount; t++) {
      const s = this.ring[t % this.capacity];
      ticks.push({ r: s.r, p: s.p, y: s.y, t: s.t, f: s.f });
    }
    return {
      tickRate: 240,
      snapshotEvery: this.snapshotEvery,
      firstTick: first,
      ticks,
      actions: this.actions.filter((a) => a.tick >= first).map((a) => ({ ...a })),
      events: this.events
        .filter((e) => e.tick >= first)
        .map((e) => ({ tick: e.tick, type: e.type, data: e.data ? [...e.data] : undefined })),
      snapshots: this.snapshots.filter((s) => s.tick >= first).map(cloneSnapshot),
    };
  }

  /** JSON of data() with inputs quantized to 4 decimals (compact export). */
  exportReplay(): string {
    const d = this.data();
    const q = (v: number): number => Math.round(v * 1e4) / 1e4;
    const ticks = d.ticks.map((t) => ({ r: q(t.r), p: q(t.p), y: q(t.y), t: q(t.t), f: t.f }));
    return JSON.stringify({ ...d, ticks });
  }

  /** Parse + minimal shape validation. */
  static importReplay(json: string): ReplayData {
    const d = JSON.parse(json) as Partial<ReplayData>;
    if (!d || typeof d !== 'object') throw new Error('invalid replay: not an object');
    if (d.tickRate !== 240) throw new Error('invalid replay: tickRate must be 240');
    if (typeof d.snapshotEvery !== 'number' || typeof d.firstTick !== 'number')
      throw new Error('invalid replay: missing snapshotEvery/firstTick');
    if (!Array.isArray(d.ticks) || !Array.isArray(d.actions) || !Array.isArray(d.events) || !Array.isArray(d.snapshots))
      throw new Error('invalid replay: ticks/actions/events/snapshots must be arrays');
    return d as ReplayData;
  }
}

function cloneSnapshot(s: Snapshot): Snapshot {
  return {
    tick: s.tick,
    quad: {
      pos: [...s.quad.pos],
      vel: [...s.quad.vel],
      quat: [...s.quad.quat],
      angVel: [...s.quad.angVel],
      thrust: s.quad.thrust,
      armed: s.quad.armed,
      crashed: s.quad.crashed,
      crashTimer: s.quad.crashTimer,
    },
    hp: s.hp,
    weapon: { ...s.weapon },
    bots: s.bots
      ? {
          kills: s.bots.kills,
          rngState: s.bots.rngState,
          bots: s.bots.bots.map((r) => [...r]),
          mark: [...s.bots.mark],
          projs: s.bots.projs.map((r) => [...r]),
        }
      : null,
  };
}

function applyQuadSnapshot(q: QuadState, s: QuadSnapshot): void {
  q.pos.fromArray(s.pos);
  q.vel.fromArray(s.vel);
  q.q.fromArray(s.quat);
  q.omega.fromArray(s.angVel);
  q.thrust = s.thrust;
  q.armed = s.armed;
  q.crashed = s.crashed;
  q.crashTimer = s.crashTimer;
}

export interface ReplayConfig {
  world: CollisionWorld | undefined;
  params: QuadParams;
  checkpoint: { pos: THREE.Vector3; yawDeg: number };
  /** BSP maps: fall below this → respawn (null = no out-of-bounds). */
  oobY: number | null;
  /** FPV camera uptilt — the weapon aims along the camera, not body-forward. */
  uptiltDeg: number;
  /** Constructs playback bots with EXACTLY the live ctor args (same world/
   *  bounds/avoid/strictFloor/extraSpawns/squad/seed/difficulty). */
  makeBots: (() => BotManager) | null;
  fx: FxSystem | null;
}

const _uptiltQ = new THREE.Quaternion();
const _aimQ = new THREE.Quaternion();
const _aimX = new THREE.Vector3(1, 0, 0);

/** Sandboxed re-simulation of a ReplayData window. Owns its own quad/weapon/
 *  hp/bots — live game state is never referenced, let alone mutated. */
export class ReplayPlayer {
  private readonly cfg: ReplayConfig;
  private data: ReplayData | null = null;
  private firstTick = 0;
  private playTick = 0;
  private actionIdx = 0;
  private weapon = new Weapon();
  private registry = new TargetRegistry();

  private _quad: QuadState = createQuadState();
  private _hp: PlayerHealth = new PlayerHealth(100);
  private _bots: BotManager | null = null;
  private _startTick = 0;
  private _endTick = 0; // exclusive: firstTick + ticks.length
  private _done = true;

  /** Transform buffers captured before each step — render interpolation. */
  readonly prevPos = new THREE.Vector3();
  readonly prevQ = new THREE.Quaternion();

  constructor(cfg: ReplayConfig) {
    this.cfg = cfg;
  }

  get quad(): QuadState {
    return this._quad;
  }
  get hp(): PlayerHealth {
    return this._hp;
  }
  get bots(): BotManager | null {
    return this._bots;
  }
  get startTick(): number {
    return this._startTick;
  }
  get endTick(): number {
    return this._endTick;
  }
  get done(): boolean {
    return this._done;
  }

  /** Load a replay window. fromTick selects the LATEST snapshot with
   *  tick <= fromTick (clamped to the oldest available); default = oldest
   *  snapshot = full buffer. Returns false when there's nothing to play. */
  load(data: ReplayData, fromTick?: number): boolean {
    if (!data.ticks.length || !data.snapshots.length) return false;
    // snapshot must sit inside the recorded input window
    const usable = data.snapshots.filter((s) => s.tick >= data.firstTick && s.tick < data.firstTick + data.ticks.length);
    if (!usable.length) return false;
    let snap = usable[0];
    if (fromTick !== undefined) {
      for (const s of usable) if (s.tick <= fromTick) snap = s;
    }

    this.data = data;
    this.firstTick = data.firstTick;
    this._startTick = snap.tick;
    this._endTick = data.firstTick + data.ticks.length;
    this.playTick = snap.tick;
    this._done = false;

    this._quad = createQuadState();
    applyQuadSnapshot(this._quad, snap.quad);
    this.prevPos.copy(this._quad.pos);
    this.prevQ.copy(this._quad.q);

    this._hp = new PlayerHealth(100); // maxHp matches the live game…
    this._hp.hp = snap.hp;            // …the snapshot carries the current hp

    this.weapon = new Weapon();
    this.weapon.restore(snap.weapon);

    if (snap.bots && this.cfg.makeBots) {
      this._bots ??= this.cfg.makeBots(); // reuse one instance across loads
      this._bots.restore(snap.bots);
    } else {
      this._bots = null;
    }

    this.registry = new TargetRegistry();
    if (this._bots) {
      const bm = this._bots;
      const fx = this.cfg.fx;
      this.registry.register({
        get targets() {
          return bm.targets;
        },
        onHit: (i, damage) => {
          const died = bm.hit(i, damage);
          if (died) fx?.explosion(died.pos);
          else fx?.impact(bm.targets[i].pos);
        },
      });
    }

    this.actionIdx = 0;
    while (this.actionIdx < data.actions.length && data.actions[this.actionIdx].tick < this.playTick)
      this.actionIdx++;
    return true;
  }

  private respawn(): void {
    resetQuad(this._quad, this.cfg.checkpoint.pos, this.cfg.checkpoint.yawDeg, 0.5);
    this._hp.reset();
  }

  /** One fixed tick, mirroring main.ts's simTick order exactly. Returns false
   *  when the recorded stream is exhausted (and sets done). */
  step(dt: number): boolean {
    const data = this.data;
    if (this._done || !data) return false;
    if (this.playTick >= this._endTick) {
      this._done = true;
      return false;
    }
    const quad = this._quad;
    const cfg = this.cfg;
    const tickIn = data.ticks[this.playTick - this.firstTick];

    // --- actions scheduled at this tick (they fire inside input.sample(),
    // before the step). At startTick the snapshot already carries the arm/
    // respawn result, so only shoot is re-applied there (its requestFire
    // queued-flag isn't part of the weapon snapshot). ---
    const atStart = this.playTick === this._startTick;
    while (this.actionIdx < data.actions.length && data.actions[this.actionIdx].tick === this.playTick) {
      const a = data.actions[this.actionIdx++];
      if (a.action === 'shoot') {
        if (quad.armed && !quad.crashed) this.weapon.requestFire(); // live guard, main.ts
      } else if (!atStart) {
        if (a.action === 'arm') {
          // live arm guard reads the PREVIOUS tick's throttle (lastThrottle)
          const prevT = this.playTick > this.firstTick ? data.ticks[this.playTick - 1 - this.firstTick].t : 0;
          if (!quad.armed) {
            if (prevT < 0.1) quad.armed = true;
          } else {
            quad.armed = false;
          }
        } else {
          this.respawn();
        }
      }
    }

    this.prevPos.copy(quad.pos);
    this.prevQ.copy(quad.q);

    stepQuad(quad, { rollRate: tickIn.r, pitchRate: tickIn.p, yawRate: tickIn.y, throttle: tickIn.t }, cfg.params, dt, cfg.world);
    if (cfg.oobY !== null && quad.pos.y < cfg.oobY) this.respawn();
    if (quad.crashed && quad.crashTimer <= 0) this.respawn();

    // --- weapon: trigger level mirrors main.ts's setTriggerHeld (hold-to-
    // autofire on instant configs, hold-to-charge on the railgun) ---
    this.weapon.setTriggerHeld((tickIn.f & 1) !== 0 && quad.armed && !quad.crashed);
    _uptiltQ.setFromAxisAngle(_aimX, (cfg.uptiltDeg * Math.PI) / 180);
    _aimQ.copy(quad.q).multiply(_uptiltQ);
    const shot = this.weapon.tick(dt, quad.pos, _aimQ, cfg.world, this.registry.collect());
    if (shot) {
      cfg.fx?.tracer(shot.from, shot.to);
      cfg.fx?.muzzle(shot.from);
      if (shot.hitWorld) cfg.fx?.impact(shot.to);
      if (shot.targetIndex !== null) this.registry.dispatchHit(shot.targetIndex, shot.damage);
    }

    // --- bots (a bot killed this tick cannot return fire — same order) ---
    if (this._bots) {
      const events = this._bots.tick(dt, {
        playerPos: quad.pos,
        playerVel: quad.vel,
        playerAlive: !quad.crashed,
        playerNoise: !!shot,
      });
      for (const ev of events) {
        if (ev.type !== 'bot-shot') continue;
        cfg.fx?.tracer(ev.from, ev.to);
        cfg.fx?.muzzle(ev.from);
        if (ev.hitPlayer && !quad.crashed) {
          if (this._hp.damage(ev.damage)) {
            quad.crashed = true;
            quad.crashTimer = cfg.params.respawnDelay;
            quad.vel.set(0, 0, 0);
            quad.thrust = 0;
          }
        }
      }
    }

    this.playTick++;
    return true;
  }

  /** Killer camera anchor: drone → bot center; soldier → eye height above
   *  the feet. False when the bot is gone/dead (caller keeps last position). */
  botEye(botIdx: number, out: THREE.Vector3): boolean {
    const t = this._bots?.targets[botIdx];
    if (!t || !t.alive) return false;
    const b = t as Bot;
    if (b.kind === 'drone') {
      out.copy(b.pos);
      return true;
    }
    const eyeH = (b.tune as SoldierTuning).eyeHeight;
    out.set(b.pos.x, b.pos.y - SOLDIER_HEIGHT / 2 + eyeH, b.pos.z);
    return true;
  }
}
