import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { MissionRunner, MissionCtx } from '../missions';
import { DUST2_MISSIONS } from '../missionDefs';

const DT = 1 / 240;

describe('MissionRunner', () => {
  // Test survive_waves: happy path
  it('survive_waves: spawns waves and wins when all cleared', () => {
    const def = DUST2_MISSIONS[0];
    const spawnWaveFn = vi.fn();
    const isHuntTargetDownFn = vi.fn();
    const hooks = { spawnWave: spawnWaveFn, isHuntTargetDown: isHuntTargetDownFn };
    const runner = new MissionRunner(def, hooks, new THREE.Vector3(0, 1, 0));

    runner.start();
    expect(runner.phase).toBe('running');
    expect(spawnWaveFn).toHaveBeenCalledWith(1, 4);

    const ctx: MissionCtx = {
      playerPos: new THREE.Vector3(0, 1, 0),
      playerAlive: true,
      kills: 0,
      botsAlive: 4,
      playerDied: false,
    };

    // Wave 1
    ctx.botsAlive = 0;
    runner.tick(DT, ctx);

    // Inter-wave delay
    const delayTicks = Math.ceil((10 + 0.5) / DT); // +0.5s buffer
    for (let i = 0; i < delayTicks; i++) {
      runner.tick(DT, ctx);
    }
    expect(spawnWaveFn).toHaveBeenCalledWith(2, 5);

    // Wave 2
    ctx.botsAlive = 5;
    ctx.botsAlive = 0;
    runner.tick(DT, ctx);

    // Inter-wave delay
    for (let i = 0; i < delayTicks; i++) {
      runner.tick(DT, ctx);
    }
    expect(spawnWaveFn).toHaveBeenCalledWith(3, 6);

    // Wave 3
    ctx.botsAlive = 6;
    ctx.botsAlive = 0;
    runner.tick(DT, ctx);

    // Inter-wave delay (will transition to won)
    for (let i = 0; i < delayTicks; i++) {
      runner.tick(DT, ctx);
    }

    expect(runner.phase).toBe('won');
    const summary = runner.summary();
    expect(summary.won).toBe(true);
    expect(summary.missionId).toBe('dust2-holdout');
  });

  it('survive_waves: respects inter-wave delay', () => {
    const def = DUST2_MISSIONS[0];
    const spawnWaveFn = vi.fn();
    const isHuntTargetDownFn = vi.fn();
    const hooks = { spawnWave: spawnWaveFn, isHuntTargetDown: isHuntTargetDownFn };
    const runner = new MissionRunner(def, hooks, new THREE.Vector3(0, 1, 0));

    runner.start();
    expect(spawnWaveFn).toHaveBeenCalledTimes(1);

    const ctx: MissionCtx = {
      playerPos: new THREE.Vector3(0, 1, 0),
      playerAlive: true,
      kills: 0,
      botsAlive: 4,
      playerDied: false,
    };

    // Simulate wave 1 completion
    ctx.botsAlive = 0;
    runner.tick(DT, ctx);

    // Should not spawn wave 2 immediately
    expect(spawnWaveFn).toHaveBeenCalledTimes(1);

    // Tick for 9.9 seconds (not yet 10)
    const shortDelayTicks = Math.floor(9.9 / DT);
    for (let i = 0; i < shortDelayTicks; i++) {
      runner.tick(DT, ctx);
    }
    expect(spawnWaveFn).toHaveBeenCalledTimes(1);

    // Tick for remaining 0.2 seconds to exceed 10 total
    for (let i = 0; i < 50; i++) {
      runner.tick(DT, ctx);
    }
    expect(spawnWaveFn).toHaveBeenCalledWith(2, 5);
  });

  it('survive_waves: loses after 3 deaths', () => {
    const def = DUST2_MISSIONS[0];
    const spawnWaveFn = vi.fn();
    const isHuntTargetDownFn = vi.fn();
    const hooks = { spawnWave: spawnWaveFn, isHuntTargetDown: isHuntTargetDownFn };
    const runner = new MissionRunner(def, hooks, new THREE.Vector3(0, 1, 0));

    runner.start();

    const ctx: MissionCtx = {
      playerPos: new THREE.Vector3(0, 1, 0),
      playerAlive: true,
      kills: 0,
      botsAlive: 4,
      playerDied: false,
    };

    // Death 1
    ctx.playerAlive = false;
    runner.tick(DT, ctx);
    expect(runner.phase).toBe('running');

    // Respawn
    ctx.playerAlive = true;
    runner.tick(DT, ctx);
    expect(runner.phase).toBe('running');

    // Death 2
    ctx.playerAlive = false;
    runner.tick(DT, ctx);
    expect(runner.phase).toBe('running');

    // Respawn
    ctx.playerAlive = true;
    runner.tick(DT, ctx);
    expect(runner.phase).toBe('running');

    // Death 3
    ctx.playerAlive = false;
    runner.tick(DT, ctx);
    expect(runner.phase).toBe('lost');

    const summary = runner.summary();
    expect(summary.won).toBe(false);
    expect(summary.deaths).toBe(3);
  });

  // Test hunt
  it('hunt: tracks objectives and wins when all down', () => {
    const def = DUST2_MISSIONS[1];
    const spawnWaveFn = vi.fn();

    // Create hunt target state
    const huntTargets = [false, false, false];
    const isHuntTargetDownFn = vi.fn((idx: number) => {
      return idx < huntTargets.length && huntTargets[idx];
    });

    const hooks = { spawnWave: spawnWaveFn, isHuntTargetDown: isHuntTargetDownFn };
    const runner = new MissionRunner(def, hooks, new THREE.Vector3(0, 1, 0));

    runner.start();
    expect(runner.phase).toBe('running');

    const ctx: MissionCtx = {
      playerPos: new THREE.Vector3(20, 1, 10),
      playerAlive: true,
      kills: 5,
      botsAlive: 0,
      playerDied: false,
    };

    // Verify objective points
    let obj = runner.objective();
    expect(obj).not.toBeNull();
    expect(obj).toEqual(new THREE.Vector3(20, 1, 10));

    // Tick with all targets still up
    runner.tick(DT, ctx);
    expect(runner.phase).toBe('running');

    // Mark target 0 as down
    huntTargets[0] = true;
    runner.tick(DT, ctx);

    // Objective should now be target 1
    obj = runner.objective();
    expect(obj).toEqual(new THREE.Vector3(-30, 1, -20));

    // Mark target 1 as down
    huntTargets[1] = true;
    runner.tick(DT, ctx);

    obj = runner.objective();
    expect(obj).toEqual(new THREE.Vector3(-50, 2, -60));

    // Mark target 2 as down
    huntTargets[2] = true;
    runner.tick(DT, ctx);

    expect(runner.phase).toBe('won');
    const summary = runner.summary();
    expect(summary.won).toBe(true);
    expect(summary.kills).toBe(5);
  });

  it('hunt: loses after 3 deaths', () => {
    const def = DUST2_MISSIONS[1];
    const spawnWaveFn = vi.fn();
    const isHuntTargetDownFn = vi.fn(() => false);
    const hooks = { spawnWave: spawnWaveFn, isHuntTargetDown: isHuntTargetDownFn };
    const runner = new MissionRunner(def, hooks, new THREE.Vector3(0, 1, 0));

    runner.start();

    const ctx: MissionCtx = {
      playerPos: new THREE.Vector3(0, 1, 0),
      playerAlive: true,
      kills: 0,
      botsAlive: 0,
      playerDied: false,
    };

    // 3 deaths
    for (let d = 1; d <= 3; d++) {
      ctx.playerAlive = false;
      runner.tick(DT, ctx);
      if (d < 3) {
        expect(runner.phase).toBe('running');
        ctx.playerAlive = true;
        runner.tick(DT, ctx);
      }
    }

    expect(runner.phase).toBe('lost');
  });

  // Test extract
  it('extract: phase 1 → hover → phase 2 → return → won', () => {
    const def = DUST2_MISSIONS[2];
    const spawnWaveFn = vi.fn();
    const isHuntTargetDownFn = vi.fn();
    const hooks = { spawnWave: spawnWaveFn, isHuntTargetDown: isHuntTargetDownFn };
    const spawn = new THREE.Vector3(0, 1, 0);
    const runner = new MissionRunner(def, hooks, spawn);

    runner.start();

    const ctx: MissionCtx = {
      playerPos: new THREE.Vector3(0, 1, 0),
      playerAlive: true,
      kills: 3,
      botsAlive: 0,
      playerDied: false,
    };

    // Phase 1: navigate to pickup point
    let obj = runner.objective();
    expect(obj).toEqual(new THREE.Vector3(-45, 3, -65));

    // Move to within 4m of pickup
    ctx.playerPos = new THREE.Vector3(-45, 3, -62); // ~3m away
    const hoverTicks = Math.ceil(3 / DT) + 10;
    for (let i = 0; i < hoverTicks; i++) {
      runner.tick(DT, ctx);
    }

    // Should now be in phase 2
    obj = runner.objective();
    expect(obj).toEqual(spawn);

    // Return to spawn (within 6m)
    ctx.playerPos = spawn.clone();
    runner.tick(DT, ctx);

    expect(runner.phase).toBe('won');
    const summary = runner.summary();
    expect(summary.won).toBe(true);
    expect(summary.kills).toBe(3);
  });

  it('extract: loses after 3 deaths', () => {
    const def = DUST2_MISSIONS[2];
    const spawnWaveFn = vi.fn();
    const isHuntTargetDownFn = vi.fn();
    const hooks = { spawnWave: spawnWaveFn, isHuntTargetDown: isHuntTargetDownFn };
    const runner = new MissionRunner(def, hooks, new THREE.Vector3(0, 1, 0));

    runner.start();

    const ctx: MissionCtx = {
      playerPos: new THREE.Vector3(0, 1, 0),
      playerAlive: true,
      kills: 0,
      botsAlive: 0,
      playerDied: false,
    };

    for (let d = 1; d <= 3; d++) {
      ctx.playerAlive = false;
      runner.tick(DT, ctx);
      if (d < 3) {
        expect(runner.phase).toBe('running');
        ctx.playerAlive = true;
        runner.tick(DT, ctx);
      }
    }

    expect(runner.phase).toBe('lost');
  });

  it('status() returns reasonable strings', () => {
    const defs = DUST2_MISSIONS;
    const spawn = new THREE.Vector3(0, 1, 0);

    // Test survive_waves status
    let runner = new MissionRunner(defs[0], { spawnWave: vi.fn(), isHuntTargetDown: vi.fn() }, spawn);
    runner.start();
    let ctx: MissionCtx = {
      playerPos: spawn,
      playerAlive: true,
      kills: 0,
      botsAlive: 4,
      playerDied: false,
    };
    let status = runner.status(ctx);
    expect(status).toContain('WAVE');
    expect(status).toContain('HOSTILES');

    // Test hunt status
    runner = new MissionRunner(defs[1], { spawnWave: vi.fn(), isHuntTargetDown: vi.fn(() => false) }, spawn);
    runner.start();
    status = runner.status(ctx);
    expect(status).toContain('TARGET');
    expect(status).toContain('DESTROY');

    // Test extract status
    runner = new MissionRunner(defs[2], { spawnWave: vi.fn(), isHuntTargetDown: vi.fn() }, spawn);
    runner.start();
    status = runner.status(ctx);
    expect(status).toContain('EXTRACT');
  });

  it('event array is reused (same instance per tick)', () => {
    const def = DUST2_MISSIONS[1];
    const spawnWaveFn = vi.fn();
    const isHuntTargetDownFn = vi.fn(() => false);
    const hooks = { spawnWave: spawnWaveFn, isHuntTargetDown: isHuntTargetDownFn };
    const runner = new MissionRunner(def, hooks, new THREE.Vector3(0, 1, 0));

    runner.start();

    const ctx: MissionCtx = {
      playerPos: new THREE.Vector3(0, 1, 0),
      playerAlive: true,
      kills: 0,
      botsAlive: 0,
      playerDied: false,
    };

    const events1 = runner.tick(DT, ctx);
    const events2 = runner.tick(DT, ctx);

    // Should be the same instance
    expect(Object.is(events1, events2)).toBe(true);
  });

  it('objective() returns correct points per mission type', () => {
    const spawn = new THREE.Vector3(0, 1, 0);

    // survive_waves: no objective
    let runner = new MissionRunner(DUST2_MISSIONS[0], { spawnWave: vi.fn(), isHuntTargetDown: vi.fn() }, spawn);
    runner.start();
    expect(runner.objective()).toBeNull();

    // hunt: returns next undowned point
    runner = new MissionRunner(DUST2_MISSIONS[1], { spawnWave: vi.fn(), isHuntTargetDown: vi.fn(() => false) }, spawn);
    runner.start();
    let obj = runner.objective();
    expect(obj?.x).toBe(20);
    expect(obj?.y).toBe(1);
    expect(obj?.z).toBe(10);

    // extract: returns pickup point in phase 1
    runner = new MissionRunner(DUST2_MISSIONS[2], { spawnWave: vi.fn(), isHuntTargetDown: vi.fn() }, spawn);
    runner.start();
    obj = runner.objective();
    expect(obj?.x).toBe(-45);
    expect(obj?.y).toBe(3);
    expect(obj?.z).toBe(-65);
  });

  it('summary() after winning captures kills and deaths', () => {
    const def = DUST2_MISSIONS[1];
    const spawnWaveFn = vi.fn();
    const isHuntTargetDownFn = vi.fn(() => true);
    const hooks = { spawnWave: spawnWaveFn, isHuntTargetDown: isHuntTargetDownFn };
    const runner = new MissionRunner(def, hooks, new THREE.Vector3(0, 1, 0));

    runner.start();

    const ctx: MissionCtx = {
      playerPos: new THREE.Vector3(0, 1, 0),
      playerAlive: true,
      kills: 7,
      botsAlive: 0,
      playerDied: false,
    };

    runner.tick(DT, ctx);

    expect(runner.phase).toBe('won');

    const summary = runner.summary();
    expect(summary.missionId).toBe('dust2-demolition');
    expect(summary.won).toBe(true);
    expect(summary.kills).toBe(7);
    expect(summary.deaths).toBe(0);
    expect(summary.timeS).toBeGreaterThan(0);
  });
});
