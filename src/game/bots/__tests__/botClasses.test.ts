/** Wave 3 bot classes: per-class tuning, the sniper charge telegraph, heavy
 *  rockets, scout noFire/marking, squad alert, shared intel, suppression. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mulberry32Stateful } from '../../rng';
import { stepDrone, stepSoldier, yawToward } from '../botBrain';
import type { BotEnv } from '../botBrain';
import { aimError } from '../botFire';
import { BotManager } from '../botManager';
import { CLASS_TUNING, TUNING } from '../types';
import type { Bot, BotClass, BotCtx, BotEvent, BotKind, BotTuning } from '../types';
import type { CollisionWorld } from '../../../physics/quad';

const DT = 1 / 240;
const S = TUNING.soldier;
const openWorld: CollisionWorld = { floorAt: () => 0 };
const BOUNDS = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
/** Player spawn far outside bounds so it never constrains placement. */
const AVOID = new THREE.Vector3(500, 0, 500);

function env(world: CollisionWorld = openWorld, over: Partial<BotEnv> = {}): BotEnv {
  return {
    world,
    floorAt: () => 0,
    sampleWaypoint: () => ({ x: 20, y: 0, z: 20 }),
    ...over,
  };
}

/** Class-aware bot factory (botBrain.test.ts's soldier() + the Wave-3 fields). */
function mkBot(kind: BotKind, cls: BotClass, x = 0, z = 0, yaw = 0, seed = 7): Bot {
  const base = cls === 'rifleman' ? TUNING[kind] : CLASS_TUNING[cls];
  const tune = { ...base } as BotTuning;
  return {
    kind,
    botClass: cls,
    pos: new THREE.Vector3(x, kind === 'soldier' ? S.height / 2 : 6, z),
    radius: tune.hitRadius,
    alive: true,
    hp: tune.hp,
    state: 'patrol',
    tune,
    tuneSuppressed: { ...tune },
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

function run(b: Bot, c: BotCtx, e: BotEnv, seconds: number, drone = false): BotEvent[] {
  const events: BotEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) (drone ? stepDrone : stepSoldier)(b, c, e, DT, events);
  return events;
}

const shots = (events: BotEvent[]) => events.filter((e) => e.type === 'bot-shot');

describe('bot classes', () => {
  it('applies class tuning at construction (sniper/heavy/scout)', () => {
    const sniper = new BotManager(openWorld, BOUNDS, AVOID, null, [], [{ kind: 'soldier', cls: 'sniper' }], 4242);
    const sb = sniper.targets[0] as Bot;
    expect(sb.botClass).toBe('sniper');
    expect(sb.tune.damage).toBe(34);
    expect(sb.tune.chargeS).toBe(1.5);

    const heavy = new BotManager(openWorld, BOUNDS, AVOID, null, [], [{ kind: 'soldier', cls: 'heavy' }], 4242);
    const hb = heavy.targets[0] as Bot;
    expect(hb.botClass).toBe('heavy');
    expect(hb.tune.projectileSpeed).toBe(12);
    expect(hb.tune.hp).toBe(50);
    expect(hb.hp).toBe(50);

    const scout = new BotManager(openWorld, BOUNDS, AVOID, null, [], [{ kind: 'drone', cls: 'scout' }], 4242);
    const cb = scout.targets[0] as Bot;
    expect(cb.botClass).toBe('scout');
    expect(cb.tune.hp).toBe(10);
    expect(cb.tune.noFire).toBe(1);
    expect(cb.tune.patrolSpeed).toBe(8);
  });

  it('sniper: the charge telegraph gates the shot, then a ~2.5s quiet window', () => {
    const b = mkBot('soldier', 'sniper');
    b.state = 'engage';
    b.burstLeft = b.tune.burstCount; // 1
    b.chargeLeft = b.tune.chargeS;   // as set on entering engage
    const c = ctx(0, 1.4, -10);
    expect(shots(run(b, c, env(), 1.4)).length).toBe(0); // still charging
    const window = shots(run(b, c, env(), 0.2)); // crosses the 1.5s mark
    expect(window.length).toBe(1);
    expect(window[0].type === 'bot-shot' && window[0].damage).toBe(34);
    expect(shots(run(b, c, env(), 2.3)).length).toBe(0); // cooldown + recharge
    expect(shots(run(b, c, env(), 0.4)).length).toBe(1); // cycle repeats ≈2.5s later
  });

  it('heavy: fires a pooled rocket (short FX-only shot event, no hitscan)', () => {
    const b = mkBot('soldier', 'heavy');
    b.state = 'engage';
    b.burstLeft = b.tune.burstCount;
    const speeds: number[] = [];
    const e = env(openWorld, {
      spawnProjectile: (_from, _dir, speed) => {
        speeds.push(speed);
      },
    });
    const events = run(b, ctx(0, 1.4, -10), e, 0.5);
    expect(speeds).toEqual([12]); // one rocket, then burstPauseS holds
    const ev = shots(events);
    expect(ev.length).toBe(1);
    const fx = ev[0];
    if (fx.type !== 'bot-shot') throw new Error('unreachable');
    expect(fx.damage).toBe(0); // the blast does the damage, not the tracer
    expect(fx.hitPlayer).toBe(false);
    expect(fx.from.distanceTo(fx.to)).toBeCloseTo(2, 6); // muzzle FX only
  });

  it('scout: noFire — paints the player for the squad instead of shooting', () => {
    const b = mkBot('drone', 'scout');
    b.state = 'engage';
    b.burstLeft = b.tune.burstCount;
    const events = run(b, ctx(0, 4, -20), env(), 0.5, true);
    expect(shots(events).length).toBe(0);
    expect(events.filter((e) => e.type === 'bot-mark').length).toBeGreaterThan(0);
  });

  it('squad alert: one bot engaging wakes patrolling teammates within 25m', () => {
    const bots = new BotManager(openWorld, BOUNDS, AVOID, null, [], [
      { kind: 'soldier', cls: 'rifleman' },
      { kind: 'soldier', cls: 'rifleman' },
    ], 4242);
    const b0 = bots.targets[0] as Bot;
    const b1 = bots.targets[1] as Bot;
    b0.pos.set(0, S.height / 2, 0);
    b0.yaw = 0; // facing -Z — at the player
    b1.pos.set(20, S.height / 2, 0);
    b1.yaw = yawToward(1, 0); // facing +X — away
    b1.waypoint = new THREE.Vector3(40, 0, 0); // keeps walking off, blind+deaf
    const c = ctx(0, 1.4, -8); // seen by b0 only (21m behind b1's back)
    let engaged = false;
    for (let i = 0; i < Math.round(2 / DT); i++) {
      const b1WasPatrol = b1.state === 'patrol';
      bots.tick(DT, c);
      if (b0.state === 'engage') {
        // b1 had no stimulus of its own — the engage transition woke it
        expect(b1WasPatrol).toBe(true);
        expect(b1.state).toBe('alert');
        expect(b1.lastKnown).not.toBeNull();
        expect(b1.lastKnown!.distanceTo(c.playerPos)).toBeLessThan(1e-9);
        engaged = true;
        break;
      }
      expect(b1.state).toBe('patrol');
    }
    expect(engaged).toBe(true);
  });

  it('scout intel: a mark alerts the squad and refreshes lastKnown for 3s', () => {
    const bots = new BotManager(openWorld, BOUNDS, AVOID, null, [], [
      { kind: 'drone', cls: 'scout' },
      { kind: 'soldier', cls: 'rifleman' },
    ], 4242);
    const scout = bots.targets[0] as Bot;
    const grunt = bots.targets[1] as Bot;
    scout.pos.set(0, 6, 0);
    grunt.pos.set(30, S.height / 2, 0); // > 25m: squad alert can't reach, mark can
    grunt.yaw = yawToward(1, 0);
    grunt.waypoint = new THREE.Vector3(60, 0, 0); // walking away, blind to it all
    const c = ctx(0, 2, -20); // scout sees it (all-round); grunt is 37m behind
    bots.tick(DT, c);
    bots.tick(DT, c);
    expect(grunt.state).toBe('alert');
    expect(grunt.lastKnown).not.toBeNull();
    expect(grunt.lastKnown!.distanceTo(c.playerPos)).toBeLessThan(1e-9);

    // the player slips out of the scout's sight: after the 3s window the
    // grunt's lastKnown stops being refreshed
    const lost = ctx(0, 2, 300);
    for (let i = 0; i < Math.round(4 / DT); i++) bots.tick(DT, lost);
    expect(grunt.lastKnown).not.toBeNull();
    const frozen = grunt.lastKnown!.clone();
    const elsewhere = ctx(100, 2, 100); // invisible to both (141m / 119m away)
    for (let i = 0; i < Math.round(0.5 / DT); i++) bots.tick(DT, elsewhere);
    expect(grunt.lastKnown).not.toBeNull();
    expect(grunt.lastKnown!.distanceTo(frozen)).toBeLessThan(1e-9);
    expect(grunt.lastKnown!.distanceTo(elsewhere.playerPos)).toBeGreaterThan(10);
  });

  it('suppression: shots passing within 2m rattle soldiers (not drones)', () => {
    const bots = new BotManager(openWorld, BOUNDS, AVOID, null, [], [
      { kind: 'soldier', cls: 'rifleman' },
      { kind: 'soldier', cls: 'rifleman' },
      { kind: 'drone', cls: 'rifleman' },
    ], 4242);
    const near = bots.targets[0] as Bot;
    const far = bots.targets[1] as Bot;
    const drone = bots.targets[2] as Bot;
    near.pos.set(0, S.height / 2, 0);
    far.pos.set(10, S.height / 2, 0);
    drone.pos.set(0, 1.5, 0); // right on the shot line, but drones don't suppress
    bots.suppressNear(new THREE.Vector3(0, 1, -10), new THREE.Vector3(0, 1, 10));
    expect(near.suppressLeft).toBeCloseTo(1.5, 9);
    expect(far.suppressLeft).toBe(0);
    expect(drone.suppressLeft).toBe(0);
    // the suppressed tune is the preallocated ×1.5 aim cone
    expect(aimError(near.tuneSuppressed, 1, 30, 5)).toBeCloseTo(aimError(near.tune, 1, 30, 5) * 1.5, 9);
  });

  it('suppression decays back to 0 after 1.5s of sim', () => {
    const b = mkBot('soldier', 'rifleman');
    b.suppressLeft = 1.5;
    run(b, ctx(500, 2, 500), env(), 1.5); // player far away — plain patrol
    expect(b.suppressLeft).toBeGreaterThanOrEqual(0);
    expect(b.suppressLeft).toBeLessThan(1e-9);
  });
});
