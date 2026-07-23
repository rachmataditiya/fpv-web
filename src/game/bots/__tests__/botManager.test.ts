/** Phase A integration: the full player-shoots-bot loop, headless —
 *  Weapon → TargetRegistry → BotManager hp/death/respawn. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Weapon, WEAPON_COOLDOWN } from '../../weapon';
import { TargetRegistry } from '../../targetRegistry';
import { BotManager, PLAYER_SHOT_DAMAGE } from '../botManager';
import { TUNING } from '../types';
import type { Bot } from '../types';
import type { CollisionWorld } from '../../../physics/quad';

const DT = 1 / 240;
const flatWorld: CollisionWorld = { floorAt: () => 0 };
const BOUNDS = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
/** Player spawn far outside bounds so it never constrains placement. */
const AVOID = new THREE.Vector3(500, 0, 500);

function makeBots() {
  return new BotManager(flatWorld, BOUNDS, AVOID);
}

/** Fire the weapon once, aimed exactly at `at` from 10m south of it. */
function shoot(weapon: Weapon, reg: TargetRegistry, at: THREE.Vector3): void {
  const from = at.clone().add(new THREE.Vector3(0, 0, 10));
  const q = new THREE.Quaternion(); // identity = aim −Z, straight at the target
  weapon.requestFire();
  const shot = weapon.tick(DT, from, q, flatWorld, reg.collect());
  expect(shot).not.toBeNull();
  expect(shot!.targetIndex).not.toBeNull();
  reg.dispatchHit(shot!.targetIndex!);
  // let the cooldown lapse so the next shoot() fires immediately
  for (let t = 0; t < WEAPON_COOLDOWN; t += DT) weapon.tick(DT, from, q, flatWorld, reg.collect());
}

describe('BotManager (Phase A dummies)', () => {
  it('spawns the default 5-bot squad (3 soldiers + 2 drones) on the floor, deterministically', () => {
    const a = makeBots();
    const b = makeBots();
    expect(a.aliveCount()).toBe(5);
    expect(a.targets.length).toBe(5);
    const kinds = a.targets.map((t) => (t as Bot).kind);
    expect(kinds.filter((k) => k === 'soldier').length).toBe(3);
    expect(kinds.filter((k) => k === 'drone').length).toBe(2);
    for (let i = 0; i < 5; i++) {
      expect(a.targets[i].pos.toArray()).toEqual(b.targets[i].pos.toArray()); // same seed → same spots
    }
  });

  it('takes PLAYER_SHOT_DAMAGE per hit and dies at 0 hp (rifleman drone = 2 taps)', () => {
    const bots = makeBots();
    const reg = new TargetRegistry();
    reg.register({ get targets() { return bots.targets; }, onHit: (i) => void bots.hit(i, PLAYER_SHOT_DAMAGE) });
    const weapon = new Weapon();
    const droneIdx = 4; // DEFAULT_SQUAD order: soldiers first, rifleman drone last
    const at = bots.targets[droneIdx].pos.clone();

    const tapsToKill = Math.ceil(TUNING.drone.hp / PLAYER_SHOT_DAMAGE);
    for (let i = 0; i < tapsToKill; i++) {
      expect(bots.targets[droneIdx].alive).toBe(true);
      shoot(weapon, reg, at);
    }
    expect(bots.targets[droneIdx].alive).toBe(false);
    expect(bots.kills).toBe(1);
    expect(bots.aliveCount()).toBe(4);
  });

  it('respawns 10s later at a fresh spot with full hp', () => {
    const bots = makeBots();
    const droneIdx = 4; // the squad's rifleman drone (TUNING.drone base)
    const before = bots.targets[droneIdx].pos.clone();
    bots.hit(droneIdx, TUNING.drone.hp); // one-shot for the test
    expect(bots.targets[droneIdx].alive).toBe(false);

    const ctx = { playerPos: AVOID, playerVel: new THREE.Vector3(), playerAlive: true, playerNoise: false };
    const ticks = Math.ceil((TUNING.drone.respawnS + 0.1) / DT);
    for (let i = 0; i < ticks; i++) bots.tick(DT, ctx);

    expect(bots.targets[droneIdx].alive).toBe(true);
    expect(bots.targets[droneIdx].pos.equals(before)).toBe(false); // new sampled spot
    expect(bots.hit(droneIdx, PLAYER_SHOT_DAMAGE)).toBeNull();     // full hp again — one tap doesn't kill
  });

  it('dead bots are ignored by hit() (no double-kill)', () => {
    const bots = makeBots();
    bots.hit(0, 999);
    expect(bots.kills).toBe(1);
    expect(bots.hit(0, 999)).toBeNull();
    expect(bots.kills).toBe(1);
  });
});
