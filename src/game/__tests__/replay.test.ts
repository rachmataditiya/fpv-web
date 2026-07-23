/** Wave 2 determinism proof: the sim is a pure function of (snapshot + input
 *  stream). Record a live run, export it, re-simulate in a ReplayPlayer
 *  sandbox, and require the final state to match bit-for-bit — for the quad
 *  alone and with live bots drawing rng alongside (snapshot restore must
 *  capture every rng stream's position exactly). */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createQuadState, resetQuad, stepQuad } from '../../physics/quad';
import type { CollisionWorld, QuadState } from '../../physics/quad';
import { DEFAULT_PARAMS } from '../../physics/params';
import type { FlightInput } from '../../input/types';
import { Weapon } from '../weapon';
import { PlayerHealth } from '../playerHealth';
import { BotManager } from '../bots/botManager';
import type { Bot } from '../bots/types';
import { ReplayPlayer, ReplayRecorder } from '../replay';
import type { QuadSnapshot } from '../replay';

const DT = 1 / 240;
const flatWorld: CollisionWorld = { floorAt: () => 0 };
const BOUNDS = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
/** Player spawn far outside bounds so it never constrains bot placement. */
const AVOID = new THREE.Vector3(500, 0, 500);

/** Quantize to 4 decimals so the export quantization is lossless. */
const q4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** Scripted, smoothly varying flight command (all values ≤4 decimals). */
function scriptCmd(i: number): FlightInput {
  return {
    rollRate: q4(Math.sin(i * 0.013) * 2.5),
    pitchRate: q4(Math.cos(i * 0.011) * 2.0),
    yawRate: q4(Math.sin(i * 0.007) * 1.5),
    throttle: q4(0.28 + 0.2 * Math.min(1, i / 240) + 0.05 * Math.sin(i * 0.005)),
  };
}

const snapQuad = (q: QuadState): QuadSnapshot => ({
  pos: q.pos.toArray(),
  vel: q.vel.toArray(),
  quat: q.q.toArray(),
  angVel: q.omega.toArray(),
  thrust: q.thrust,
  armed: q.armed,
  crashed: q.crashed,
  crashTimer: q.crashTimer,
});

/** main.ts's crash/respawn rules, verbatim minus fx/hud. */
function liveRespawnRules(quad: QuadState, hp: PlayerHealth, cp: { pos: THREE.Vector3; yawDeg: number }): void {
  if (quad.crashed && quad.crashTimer <= 0) {
    resetQuad(quad, cp.pos, cp.yawDeg, 0.5);
    hp.reset();
  }
}

describe('replay round-trip (quad only)', () => {
  it('re-simulates the recorded stream bit-exactly', () => {
    const cp = { pos: new THREE.Vector3(0, 0, 0), yawDeg: 0 };
    const quad = createQuadState();
    resetQuad(quad, cp.pos, cp.yawDeg, 0.5);
    quad.armed = true;
    const weapon = new Weapon();
    const hp = new PlayerHealth(100);

    const recorder = new ReplayRecorder({ snapshotEveryTicks: 240 });
    recorder.captureFn = () => ({
      quad: snapQuad(quad),
      hp: hp.hp,
      weapon: weapon.serialize(),
      bots: null,
    });

    for (let i = 0; i < 720; i++) {
      const cmd = scriptCmd(i);
      recorder.recordTick(cmd, false);
      stepQuad(quad, cmd, DEFAULT_PARAMS, DT, flatWorld);
      liveRespawnRules(quad, hp, cp);
    }

    const data = ReplayRecorder.importReplay(recorder.exportReplay());
    expect(data.snapshots.map((s) => s.tick)).toEqual([0, 240, 480]);

    const player = new ReplayPlayer({
      world: flatWorld,
      params: DEFAULT_PARAMS,
      checkpoint: cp,
      oobY: null,
      uptiltDeg: 25,
      makeBots: null,
      fx: null,
    });
    expect(player.load(data)).toBe(true);
    expect(player.startTick).toBe(0); // default = oldest snapshot = full buffer
    while (player.step(DT)) {}
    expect(player.done).toBe(true);
    expect(player.quad.pos.toArray()).toEqual(quad.pos.toArray());
    expect(player.quad.vel.toArray()).toEqual(quad.vel.toArray());
    expect(player.quad.q.toArray()).toEqual(quad.q.toArray());
    expect(player.quad.pos.distanceTo(quad.pos)).toBeLessThan(1e-9);

    // mid-stream snapshot restore: latest snapshot ≤ fromTick, same finish
    const mid = new ReplayPlayer({
      world: flatWorld,
      params: DEFAULT_PARAMS,
      checkpoint: cp,
      oobY: null,
      uptiltDeg: 25,
      makeBots: null,
      fx: null,
    });
    expect(mid.load(data, 500)).toBe(true);
    expect(mid.startTick).toBe(480);
    while (mid.step(DT)) {}
    expect(mid.quad.pos.toArray()).toEqual(quad.pos.toArray());
  });
});

describe('replay with bots (rng-state restore fidelity)', () => {
  const mkBots = () => new BotManager(flatWorld, BOUNDS, AVOID, null, [], { drones: 1, soldiers: 1 }, 4242);

  function runLive(): { quad: QuadState; bots: BotManager; cp: { pos: THREE.Vector3; yawDeg: number }; data: ReturnType<ReplayRecorder['data']>; shots: number } {
    const bots = mkBots();
    const dronePos = bots.targets[0].pos.clone(); // drones are constructed first
    const cp = { pos: dronePos.clone().add(new THREE.Vector3(12, 0, 0)), yawDeg: 0 };
    const quad = createQuadState();
    resetQuad(quad, cp.pos, cp.yawDeg, 0); // hovering right next to the drone
    quad.armed = true;
    const weapon = new Weapon();
    const hp = new PlayerHealth(100);

    const recorder = new ReplayRecorder({ snapshotEveryTicks: 240 });
    recorder.captureFn = () => ({
      quad: snapQuad(quad),
      hp: hp.hp,
      weapon: weapon.serialize(),
      bots: bots.serialize(),
    });

    let shots = 0;
    for (let i = 0; i < 720; i++) {
      const cmd = scriptCmd(i);
      recorder.recordTick(cmd, false);
      stepQuad(quad, cmd, DEFAULT_PARAMS, DT, flatWorld);
      liveRespawnRules(quad, hp, cp);
      const events = bots.tick(DT, {
        playerPos: quad.pos,
        playerVel: quad.vel,
        playerAlive: !quad.crashed,
        playerNoise: false,
      });
      for (const ev of events) {
        if (ev.type !== 'bot-shot') continue;
        shots++;
        if (ev.hitPlayer && !quad.crashed && hp.damage(ev.damage)) {
          quad.crashed = true;
          quad.crashTimer = DEFAULT_PARAMS.respawnDelay;
          quad.vel.set(0, 0, 0);
          quad.thrust = 0;
        }
      }
    }
    return { quad, bots, cp, data: ReplayRecorder.importReplay(recorder.exportReplay()), shots };
  }

  it('playback bots match the live bots bit-exactly (full stream + mid-stream restore)', () => {
    const { quad, bots, cp, data, shots } = runLive();
    expect(shots).toBeGreaterThan(0); // the drone really engaged — rng was drawn

    const mkPlayer = () =>
      new ReplayPlayer({
        world: flatWorld,
        params: DEFAULT_PARAMS,
        checkpoint: cp, // same respawn point the live loop used
        oobY: null,
        uptiltDeg: 25,
        makeBots: mkBots,
        fx: null,
      });

    // full buffer from the oldest snapshot
    const full = mkPlayer();
    expect(full.load(data)).toBe(true);
    while (full.step(DT)) {}
    // mid-stream restore (snapshot at tick 480)
    const mid = mkPlayer();
    expect(mid.load(data, 500)).toBe(true);
    expect(mid.startTick).toBe(480);
    while (mid.step(DT)) {}

    for (const p of [full, mid]) {
      expect(p.quad.pos.toArray()).toEqual(quad.pos.toArray());
      expect(p.bots).not.toBeNull();
      expect(p.bots!.kills).toBe(bots.kills);
      for (let i = 0; i < bots.targets.length; i++) {
        expect(p.bots!.targets[i].pos.toArray()).toEqual(bots.targets[i].pos.toArray());
        expect(p.bots!.targets[i].alive).toBe(bots.targets[i].alive);
        expect((p.bots!.targets[i] as Bot).hp).toBe((bots.targets[i] as Bot).hp);
      }
    }
  });
});

describe('replay export/import shape', () => {
  it('preserves counts and quantizes inputs to 4 decimals', () => {
    const quad = createQuadState();
    const weapon = new Weapon();
    const recorder = new ReplayRecorder({ capacityTicks: 480, snapshotEveryTicks: 120 });
    recorder.captureFn = () => ({
      quad: snapQuad(quad),
      hp: 100,
      weapon: weapon.serialize(),
      bots: null,
    });
    const raw: FlightInput[] = [];
    for (let i = 0; i < 200; i++) {
      const cmd: FlightInput = {
        rollRate: Math.PI / 3 + i * 0.00001, // deliberately not 4-decimal-clean
        pitchRate: -Math.E / 7,
        yawRate: 0.123456789,
        throttle: 0.5,
      };
      raw.push(cmd);
      recorder.recordTick(cmd, i % 3 === 0);
    }
    recorder.recordAction('arm');
    recorder.recordAction('shoot');
    recorder.logEvent('shot', [1, 2, 3]);
    recorder.logEvent('bot-died');
    recorder.logEvent('player-died', [4, 5, 6]);

    // data() (killcam fast path) keeps raw floats
    const mem = recorder.data();
    expect(mem.ticks[7].r).toBe(raw[7].rollRate);
    expect(mem.firstTick).toBe(0);

    const data = ReplayRecorder.importReplay(recorder.exportReplay());
    expect(data.tickRate).toBe(240);
    expect(data.snapshotEvery).toBe(120);
    expect(data.firstTick).toBe(0);
    expect(data.ticks.length).toBe(200);
    expect(data.snapshots.map((s) => s.tick)).toEqual([0, 120]);
    expect(data.actions.length).toBe(2);
    expect(data.events.length).toBe(3);
    expect(data.actions[1].action).toBe('shoot');
    expect(data.events[2].data).toEqual([4, 5, 6]);
    for (const t of data.ticks) {
      for (const v of [t.r, t.p, t.y, t.t]) {
        expect(Math.abs(v * 1e4 - Math.round(v * 1e4))).toBeLessThan(1e-6);
      }
    }
    // quantization actually happened (raw value had more decimals)
    expect(data.ticks[0].y).not.toBe(raw[0].yawRate);
    expect(data.ticks[0].y).toBe(0.1235);
    // flags survive unquantized
    expect(data.ticks[0].f).toBe(1);
    expect(data.ticks[1].f).toBe(0);
  });

  it('rejects malformed replays', () => {
    expect(() => ReplayRecorder.importReplay('{}')).toThrow();
    expect(() => ReplayRecorder.importReplay('{"tickRate":60,"ticks":[]}')).toThrow();
    expect(() => ReplayRecorder.importReplay('not json')).toThrow();
  });
});
