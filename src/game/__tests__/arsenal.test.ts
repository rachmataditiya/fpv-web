/** Wave 4 — player arsenal & pickups: config table sanity, burst timing,
 *  railgun charge gating, blaster back-compat, pickup trigger/respawn, and
 *  serialize round-trip fidelity (mid-burst). */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Weapon, WEAPON_CONFIGS, WEAPON_COOLDOWN } from '../weapon';
import type { WeaponId } from '../weapon';
import { PLAYER_SHOT_DAMAGE } from '../bots/types';
import { PickupField } from '../pickups';
import type { CollisionWorld } from '../../physics/quad';

const DT = 1 / 240;
const pos = new THREE.Vector3(0, 2, 0);
const facingMinusZ = new THREE.Quaternion(); // identity: forward = −Z
const flatWorld: CollisionWorld = { floorAt: () => 0 };

describe('weapon config table', () => {
  it('has 3 unique configs with sane numbers; blaster matches the legacy constants', () => {
    const ids = Object.keys(WEAPON_CONFIGS);
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      const c = WEAPON_CONFIGS[id as WeaponId];
      expect(c.id).toBe(id);
      expect(c.name).toBe(c.name.toUpperCase());
      expect(c.damage).toBeGreaterThan(0);
      expect(c.cooldownS).toBeGreaterThan(0);
      expect(c.heatCoolRate).toBeGreaterThan(0);
      expect(c.heatMax).toBeGreaterThan(0);
      expect(c.spreadPerHeat).toBeGreaterThan(0);
      expect(c.burstCount).toBeGreaterThan(0);
      expect(c.heatPerShot).toBeGreaterThanOrEqual(0); // railgun: no heat spread
      expect(c.burstIntervalS).toBeGreaterThanOrEqual(0);
      expect(c.chargeS).toBeGreaterThanOrEqual(0);
    }
    expect(WEAPON_CONFIGS.blaster.cooldownS).toBe(WEAPON_COOLDOWN);
    expect(WEAPON_CONFIGS.blaster.damage).toBe(PLAYER_SHOT_DAMAGE);
    expect(WEAPON_CONFIGS.burst.burstCount).toBe(3);
    expect(WEAPON_CONFIGS.railgun.chargeS).toBe(0.8);
  });
});

describe('blaster back-compat', () => {
  it('default Weapon fires laser-exact first shot and auto-fires ~9 rps while held', () => {
    const w = new Weapon();
    expect(w.config.id).toBe('blaster');
    w.requestFire();
    const shot = w.tick(DT, pos, facingMinusZ, undefined, [])!;
    expect(shot).not.toBeNull();
    expect(shot.damage).toBe(PLAYER_SHOT_DAMAGE);
    // no heat yet → zero spread: straight down −Z from just past the props
    expect(shot.to.x).toBeCloseTo(0, 6);
    expect(shot.to.y).toBeCloseTo(2, 6);
    expect(shot.to.z).toBeCloseTo(-300.15, 1);

    // hold the trigger for one sim-second → ~9 rounds
    const w2 = new Weapon();
    w2.setTriggerHeld(true);
    let shots = 0;
    for (let i = 0; i < 240; i++) {
      if (w2.tick(DT, pos, facingMinusZ, undefined, [])) shots++;
    }
    expect(shots).toBe(9);
  });
});

describe('burst config', () => {
  it('fires a 3-round burst per trigger, then pauses for cooldownS', () => {
    const w = new Weapon('burst');
    w.requestFire();
    const shotTicks: number[] = [];
    for (let i = 0; i < 60; i++) {
      const s = w.tick(DT, pos, facingMinusZ, undefined, []);
      if (s) {
        shotTicks.push(i);
        expect(s.damage).toBe(7);
      }
    }
    expect(shotTicks.length).toBe(3);
    expect(shotTicks[0]).toBe(0);
    expect(Math.abs(shotTicks[1] * DT - 0.06)).toBeLessThanOrEqual(DT + 1e-9);
    expect(Math.abs(shotTicks[2] * DT - 0.12)).toBeLessThanOrEqual(DT + 1e-9);

    // post-burst pause: a fresh trigger during the cooldown is dropped
    w.requestFire();
    for (let i = 60; i < 95; i++) {
      expect(w.tick(DT, pos, facingMinusZ, undefined, [])).toBeNull();
    }
    // once cooldownS has elapsed a new trigger starts a fresh burst
    for (let i = 95; i < 100; i++) w.tick(DT, pos, facingMinusZ, undefined, []);
    w.requestFire();
    const s = w.tick(DT, pos, facingMinusZ, undefined, []);
    expect(s).not.toBeNull();
    expect(s!.damage).toBe(7);
  });

  it('ignores a fresh trigger mid-burst', () => {
    const w = new Weapon('burst');
    w.requestFire();
    expect(w.tick(DT, pos, facingMinusZ, undefined, [])).not.toBeNull(); // round 1
    w.requestFire(); // mid-burst — must be ignored (no reset of the burst)
    const shotTicks: number[] = [];
    for (let i = 1; i < 40; i++) {
      if (w.tick(DT, pos, facingMinusZ, undefined, [])) shotTicks.push(i);
    }
    expect(shotTicks.length).toBe(2); // only rounds 2 and 3 of the same burst
    expect(Math.abs(shotTicks[0] * DT - 0.06)).toBeLessThanOrEqual(DT + 1e-9);
    expect(Math.abs(shotTicks[1] * DT - 0.12)).toBeLessThanOrEqual(DT + 1e-9);
  });
});

describe('railgun charge gating', () => {
  it('early release fizzles (no shot, charge resets); requestFire is a no-op', () => {
    const w = new Weapon('railgun');
    w.requestFire(); // charge configs ignore the edge
    expect(w.tick(DT, pos, facingMinusZ, undefined, [])).toBeNull();

    w.setTriggerHeld(true);
    for (let i = 0; i < 100; i++) { // ~0.42 s < 0.8 s
      expect(w.tick(DT, pos, facingMinusZ, undefined, [])).toBeNull();
    }
    expect(w.charge01()).toBeGreaterThan(0);
    w.setTriggerHeld(false);
    expect(w.tick(DT, pos, facingMinusZ, undefined, [])).toBeNull(); // release: no fire
    expect(w.charge01()).toBe(0); // charge reset
  });

  it('full charge + release fires exactly one 40-damage shot, then blocks ~2 s', () => {
    const w = new Weapon('railgun');
    w.setTriggerHeld(true);
    for (let i = 0; i < 192; i++) { // exactly 0.8 s
      expect(w.tick(DT, pos, facingMinusZ, undefined, [])).toBeNull();
    }
    expect(w.charge01()).toBeCloseTo(1, 6);
    w.setTriggerHeld(false);
    const shot = w.tick(DT, pos, facingMinusZ, undefined, []);
    expect(shot).not.toBeNull();
    expect(shot!.damage).toBe(40);
    expect(w.charge01()).toBe(0);
    expect(w.cooldown01()).toBeGreaterThan(0.9);
    // exactly one shot per release
    expect(w.tick(DT, pos, facingMinusZ, undefined, [])).toBeNull();

    // holding inside the cooldown window builds no charge; release → nothing
    w.setTriggerHeld(true);
    for (let i = 0; i < 240; i++) { // 1 s < 2 s cooldown
      expect(w.tick(DT, pos, facingMinusZ, undefined, [])).toBeNull();
    }
    expect(w.charge01()).toBe(0);
    w.setTriggerHeld(false);
    expect(w.tick(DT, pos, facingMinusZ, undefined, [])).toBeNull();

    // after the cooldown a fresh full charge fires again
    for (let i = 0; i < 250; i++) w.tick(DT, pos, facingMinusZ, undefined, []);
    w.setTriggerHeld(true);
    for (let i = 0; i < 200; i++) w.tick(DT, pos, facingMinusZ, undefined, []);
    w.setTriggerHeld(false);
    const shot2 = w.tick(DT, pos, facingMinusZ, undefined, []);
    expect(shot2).not.toBeNull();
    expect(shot2!.damage).toBe(40);
  });
});

describe('setConfig', () => {
  it('swaps behavior and resets heat/charge/burst/cooldown', () => {
    const w = new Weapon();
    w.setTriggerHeld(true);
    for (let i = 0; i < 30; i++) w.tick(DT, pos, facingMinusZ, undefined, []);
    expect(w.heat01()).toBeGreaterThan(0);
    w.setConfig('railgun');
    expect(w.config.id).toBe('railgun');
    expect(w.heat01()).toBe(0);
    expect(w.charge01()).toBe(0);
    expect(w.cooldown01()).toBe(0);
    // railgun rules now apply: the held trigger charges instead of auto-firing
    expect(w.tick(DT, pos, facingMinusZ, undefined, [])).toBeNull();
    expect(w.charge01()).toBeGreaterThan(0);
    w.setConfig('blaster'); // resets the pending charge too
    expect(w.charge01()).toBe(0);
  });
});

describe('serialize round-trip', () => {
  it('mid-burst snapshot restores identical subsequent shot timing', () => {
    const a = new Weapon('burst');
    a.setTriggerHeld(true);
    const early: number[] = [];
    for (let i = 0; i < 5; i++) {
      if (a.tick(DT, pos, facingMinusZ, undefined, [])) early.push(i);
    }
    expect(early).toEqual([0]); // round 1 fired, rounds 2–3 pending

    const snap = a.serialize();
    expect(snap.configId).toBe('burst');
    expect(snap.burstLeft).toBe(2);

    const b = new Weapon(); // blaster default — restore must swap the config
    b.restore(snap);
    expect(b.config.id).toBe('burst');
    b.setTriggerHeld(true);

    for (let i = 5; i < 300; i++) {
      const sa = a.tick(DT, pos, facingMinusZ, undefined, []);
      const sb = b.tick(DT, pos, facingMinusZ, undefined, []);
      expect(!!sb).toBe(!!sa);
      if (sa && sb) {
        expect(sb.damage).toBe(sa.damage);
        expect(sb.to.x).toBeCloseTo(sa.to.x, 10);
        expect(sb.to.y).toBeCloseTo(sa.to.y, 10);
        expect(sb.to.z).toBeCloseTo(sa.to.z, 10);
      }
    }
  });
});

describe('PickupField', () => {
  const BOUNDS = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  const AVOID = new THREE.Vector3(500, 0, 500); // far outside bounds

  it('places all 6 pickups on the floor (hover 1.2 m), 2 of each weapon', () => {
    const field = new PickupField(flatWorld, BOUNDS, AVOID, 7331, null, 6);
    expect(field.pickups.length).toBe(6);
    const counts: Record<string, number> = {};
    for (const p of field.pickups) {
      expect(p.alive).toBe(true);
      expect(p.pos.y).toBeCloseTo(1.2, 6);
      counts[p.weapon] = (counts[p.weapon] ?? 0) + 1;
    }
    expect(counts).toEqual({ blaster: 2, burst: 2, railgun: 2 });
  });

  it('triggers within 1.5 m while alive, then respawns in place after ~20 s', () => {
    const field = new PickupField(flatWorld, BOUNDS, AVOID, 7331, null, 6);
    const i = 2;
    const p = field.pickups[i];
    const far = new THREE.Vector3(500, 0, 500);

    // outside the radius → no event for this pickup
    const outside = field.tick(DT, new THREE.Vector3(p.pos.x + 10, p.pos.y, p.pos.z), true);
    expect(outside.some((e) => e.index === i)).toBe(false);
    expect(p.alive).toBe(true);

    // dead player on top → no pickup
    expect(field.tick(DT, p.pos.clone(), false).some((e) => e.index === i)).toBe(false);
    expect(p.alive).toBe(true);

    // on top of it, alive → event with index + weapon, collected
    const evs = field.tick(DT, p.pos.clone(), true);
    expect(evs.length).toBe(1);
    expect(evs[0].type).toBe('pickup');
    expect(evs[0].index).toBe(i);
    expect(evs[0].weapon).toBe(p.weapon);
    expect(p.alive).toBe(false);
    expect(p.respawnIn).toBeCloseTo(20, 1);

    // no re-trigger while waiting; countdown runs
    expect(field.tick(DT, p.pos.clone(), true)).toEqual([]);
    expect(p.respawnIn).toBeLessThan(20);

    // ~20 s later it respawns in place, same weapon
    const weaponBefore = p.weapon;
    const posBefore = p.pos.clone();
    for (let t = 0; t < 20.5; t += DT) field.tick(DT, far, true);
    expect(p.alive).toBe(true);
    expect(p.respawnIn).toBe(0);
    expect(p.weapon).toBe(weaponBefore);
    expect(p.pos.equals(posBefore)).toBe(true);
  });
});
