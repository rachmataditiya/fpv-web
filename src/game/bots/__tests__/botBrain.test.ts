import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mulberry32Stateful } from '../../rng';
import { stepDrone, stepSoldier, yawToward } from '../botBrain';
import type { BotEnv } from '../botBrain';
import { TUNING } from '../types';
import type { Bot, BotCtx, BotEvent } from '../types';
import type { CollisionWorld } from '../../../physics/quad';

const DT = 1 / 240;
const S = TUNING.soldier;

const openWorld: CollisionWorld = { floorAt: () => 0 };
/** Wall across z = -5 blocking any segment that crosses it. */
const walledWorld: CollisionWorld = {
  floorAt: () => 0,
  sweep: (from, to) => {
    const t = (-5 - from.z) / (to.z - from.z);
    if (!isFinite(t) || t < 0 || t > 1) return null;
    return {
      point: new THREE.Vector3(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, -5),
      normal: new THREE.Vector3(0, 0, 1),
    };
  },
};

function env(world: CollisionWorld = openWorld, over: Partial<BotEnv> = {}): BotEnv {
  return {
    world,
    floorAt: () => 0,
    sampleWaypoint: () => ({ x: 20, y: 0, z: 20 }),
    ...over,
  };
}

function soldier(x = 0, z = 0, yaw = 0, seed = 7): Bot {
  return {
    kind: 'soldier',
    botClass: 'rifleman',
    pos: new THREE.Vector3(x, S.height / 2, z),
    radius: S.hitRadius,
    alive: true,
    hp: S.hp,
    state: 'patrol',
    tune: { ...S },
    tuneSuppressed: { ...S },
    chargeLeft: 0,
    suppressLeft: 0,
    vel: new THREE.Vector3(),
    yaw,
    respawnIn: 0,
    mesh: new THREE.Group(),
    rng: mulberry32Stateful(seed),
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
}

function ctx(px: number, py: number, pz: number, over: Partial<BotCtx> = {}): BotCtx {
  return {
    playerPos: new THREE.Vector3(px, py, pz),
    playerVel: new THREE.Vector3(),
    playerAlive: true,
    playerNoise: false,
    ...over,
  };
}

function run(b: Bot, c: BotCtx, e: BotEnv, seconds: number): BotEvent[] {
  const events: BotEvent[] = [];
  for (let t = 0; t < seconds; t += DT) stepSoldier(b, c, e, DT, events);
  return events;
}

describe('soldier brain', () => {
  it('patrol → alert on line of sight, engages after the reaction delay', () => {
    const b = soldier(0, 0, 0); // yaw 0 faces -Z
    const c = ctx(0, 2, -15);
    stepSoldier(b, c, env(), DT, []);
    expect(b.state).toBe('alert');
    run(b, c, env(), S.reactionS + 0.05);
    expect(b.state).toBe('engage');
  });

  it('does not notice a quiet, distant player behind it', () => {
    const b = soldier(0, 0, 0);
    // behind a -Z-facing soldier, beyond rotorHearRange (18m)
    run(b, ctx(0, 2, 25), env(), 0.5);
    expect(b.state).toBe('patrol');
  });

  it('hears the rotors of a player hovering close, even without a shot', () => {
    const b = soldier(0, 0, 0);
    stepSoldier(b, ctx(0, 3, 10), env(), DT, []); // behind it, silent, 10m
    expect(b.state).toBe('alert');
    expect(b.lastKnown).not.toBeNull();
  });

  it('hears a player shot from further out and turns alert', () => {
    const b = soldier(0, 0, 0);
    stepSoldier(b, ctx(0, 2, 30, { playerNoise: true }), env(), DT, []);
    expect(b.state).toBe('alert');
    expect(b.lastKnown).not.toBeNull();
  });

  it('fires in bursts: 3 quick shots, then a pause', () => {
    const b = soldier(0, 0, 0);
    b.state = 'engage';
    b.burstLeft = S.burstCount;
    const c = ctx(0, 1.4, -10);
    const events = run(b, c, env(), 0.5);
    const shots = events.filter((e) => e.type === 'bot-shot');
    expect(shots.length).toBe(S.burstCount); // burst done, pause holds the 4th
    // window long enough for the pause remainder + one full follow-up burst
    const more = run(b, c, env(), S.burstPauseS + S.burstInterval * S.burstCount);
    expect(more.filter((e) => e.type === 'bot-shot').length).toBe(S.burstCount);
  });

  it('lands hits on a close hovering player (damage flows in events)', () => {
    const b = soldier(0, 0, 0);
    b.state = 'engage';
    b.burstLeft = S.burstCount;
    const events = run(b, ctx(0, 1.4, -8), env(), 4);
    const hits = events.filter((e) => e.type === 'bot-shot' && e.hitPlayer);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].type === 'bot-shot' && hits[0].damage).toBe(S.damage);
  });

  it('walls break line of sight → engage decays to seek, then gives up', () => {
    // wall at z=-5 blocks vision; the floor also ends there (like a real BSP,
    // where floorAt at a wall returns the wall top and the step gets rejected)
    const wallEnv = env(walledWorld, { floorAt: (_x, z) => (z < -5 ? null : 0) });
    const b = soldier(0, 0, 0);
    b.state = 'engage';
    b.burstLeft = S.burstCount;
    b.lastKnown = new THREE.Vector3(0, 2, -40); // beyond the wall — unreachable
    const c = ctx(0, 2, -40);
    const events = run(b, c, wallEnv, S.losLossToSeekS + 0.1);
    expect(events.filter((e) => e.type === 'bot-shot').length).toBe(0); // never fired blind
    expect(b.state).toBe('seek');
    run(b, c, wallEnv, S.seekTimeoutS + 0.1); // walks to the wall, gets blocked
    expect(b.state).toBe('patrol');
    expect(b.pos.z).toBeGreaterThanOrEqual(-5.01); // never crossed the wall line
  });

  it('refuses ledges: stops at the floor edge instead of walking off', () => {
    const cliffEnv = env(openWorld, {
      floorAt: (x) => (x > 5 ? null : 0), // world ends at x = 5
      sampleWaypoint: () => ({ x: 10, y: 0, z: 0 }),
    });
    const b = soldier(0, 0, yawToward(1, 0)); // already facing the waypoint
    run(b, ctx(500, 2, 500), cliffEnv, 5); // player far away — pure patrol
    expect(b.pos.x).toBeLessThanOrEqual(5.01);
    expect(b.pos.x).toBeGreaterThan(1); // it did walk
  });

  it('is deterministic: identical seeds → identical trajectories and shots', () => {
    const runOne = () => {
      const b = soldier(3, 4, 1, 99);
      const events = run(b, ctx(0, 2, -12), env(), 3);
      return { pos: b.pos.toArray(), yaw: b.yaw, shots: events.filter((e) => e.type === 'bot-shot').length };
    };
    expect(runOne()).toEqual(runOne());
  });
});

const DR = TUNING.drone;

function droneBot(x = 0, y = 6, z = 0, yaw = 0, seed = 21): Bot {
  const b = soldier(x, z, yaw, seed);
  b.kind = 'drone';
  b.pos.set(x, y, z);
  b.radius = DR.hitRadius;
  b.hp = DR.hp;
  b.tune = { ...DR };
  return b;
}

function runDrone(b: Bot, c: BotCtx, e: BotEnv, seconds: number): BotEvent[] {
  const events: BotEvent[] = [];
  for (let t = 0; t < seconds; t += DT) stepDrone(b, c, e, DT, events);
  return events;
}

describe('drone brain', () => {
  it('spots the player all-round (no blind side) and engages', () => {
    const b = droneBot(0, 6, 0, 0); // facing -Z; player BEHIND at +Z
    const c = ctx(0, 5, 40);
    runDrone(b, c, env(), DR.reactionS + 0.1);
    expect(b.state).toBe('engage');
  });

  it('pursues into the engage band and keeps its distance while firing', () => {
    const b = droneBot(0, 6, 0, 0);
    const c = ctx(70, 4, 0); // far outside engageMax
    const events = runDrone(b, c, env(), 12);
    const horiz = Math.hypot(c.playerPos.x - b.pos.x, c.playerPos.z - b.pos.z);
    expect(horiz).toBeLessThanOrEqual(DR.engageMax + 4);
    expect(horiz).toBeGreaterThanOrEqual(DR.engageMin - 4);
    expect(events.filter((e) => e.type === 'bot-shot').length).toBeGreaterThan(0);
  });

  it('steers back into its altitude band over the floor', () => {
    const b = droneBot(0, 30, 0, 0); // spawned way above the band
    runDrone(b, ctx(500, 5, 500), env(), 6); // player far — pure patrol
    const agl = b.pos.y; // flat floor at 0
    expect(agl).toBeLessThanOrEqual(DR.altMax + 0.5);
    expect(agl).toBeGreaterThanOrEqual(DR.altMin - 0.5);
  });

  it('patrols between waypoints when unaware', () => {
    const wp: { x: number; y: number; z: number }[] = [
      { x: 30, y: 0, z: 0 }, { x: 0, y: 0, z: 30 }, { x: -30, y: 0, z: 0 },
    ];
    let i = 0;
    const e = env(openWorld, { sampleWaypoint: () => wp[i++ % wp.length] });
    const b = droneBot(0, 6, 0, 0);
    const start = b.pos.clone();
    runDrone(b, ctx(500, 5, 500), e, 6);
    expect(b.pos.distanceTo(start)).toBeGreaterThan(10);
  });

  it('is deterministic: identical seeds → identical flight and shots', () => {
    const runOne = () => {
      const b = droneBot(5, 6, -5, 2, 77);
      const events = runDrone(b, ctx(-20, 4, 10), env(), 5);
      return { pos: b.pos.toArray(), shots: events.filter((e) => e.type === 'bot-shot').length };
    };
    expect(runOne()).toEqual(runOne());
  });
});
