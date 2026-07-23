import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { FlightInput } from '../../input/types';
import { DEFAULT_PARAMS } from '../params';
import { createQuadState, resetQuad, stepQuad } from '../quad';

const dt = 1 / 240;

// hover throttle = weight / max thrust
const hoverThrottle = (DEFAULT_PARAMS.mass * DEFAULT_PARAMS.g) / DEFAULT_PARAMS.maxThrust;

/**
 * Helper: call stepQuad repeatedly for a given duration
 */
function stepForDuration(
  state: ReturnType<typeof createQuadState>,
  input: FlightInput,
  duration: number,
): void {
  const steps = Math.round(duration / dt);
  for (let i = 0; i < steps; i++) {
    stepQuad(state, input, DEFAULT_PARAMS, dt);
  }
}

describe('Quadcopter Flight Model', () => {
  // 1. Disarmed quad falls
  it('disarmed quad falls under gravity', () => {
    const state = createQuadState();
    const startPos = new THREE.Vector3(0, 0, 0);
    resetQuad(state, startPos, 0, 5); // starts at y=5 after reset
    const startY = state.pos.y;

    const input: FlightInput = {
      throttle: 0,
      rollRate: 0,
      pitchRate: 0,
      yawRate: 0,
    };

    stepForDuration(state, input, 1.0); // 1 second

    expect(state.pos.y).toBeLessThan(startY);
    expect(state.vel.y).toBeLessThan(0);
  });

  // 2. Armed hover
  it('maintains hover when armed at hover throttle', () => {
    const state = createQuadState();
    const startPos = new THREE.Vector3(0, 0, 0);
    resetQuad(state, startPos, 0, 5); // starts at y=5 after reset
    const startY = state.pos.y;
    state.armed = true;

    const input: FlightInput = {
      throttle: hoverThrottle,
      rollRate: 0,
      pitchRate: 0,
      yawRate: 0,
    };

    stepForDuration(state, input, 2.0); // 2 seconds

    expect(Math.abs(state.vel.y)).toBeLessThan(0.5);
    expect(state.pos.y).toBeGreaterThan(startY - 1.0);
    expect(state.pos.y).toBeLessThan(startY + 1.0);
  });

  // 3. Full throttle climbs
  it('climbs rapidly at full throttle', () => {
    const state = createQuadState();
    const startPos = new THREE.Vector3(0, 0, 0);
    resetQuad(state, startPos, 0, 5); // starts at y=5 after reset
    state.armed = true;

    const input: FlightInput = {
      throttle: 1.0,
      rollRate: 0,
      pitchRate: 0,
      yawRate: 0,
    };

    stepForDuration(state, input, 1.0);

    expect(state.vel.y).toBeGreaterThan(5);
  });

  // 4. Rate command – roll 45° in 0.25 s
  it('achieves 45° roll after 0.25 s of π rad/s roll rate', () => {
    const state = createQuadState();
    const startPos = new THREE.Vector3(0, 0, 0);
    resetQuad(state, startPos, 0, 5);
    state.armed = true;

    const input: FlightInput = {
      throttle: hoverThrottle,
      rollRate: Math.PI, // rad/s
      pitchRate: 0,
      yawRate: 0,
    };

    stepForDuration(state, input, 0.25);

    // body up vector in world frame
    const worldUp = new THREE.Vector3(0, 1, 0);
    const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(state.q);

    const tiltAngle = bodyUp.angleTo(worldUp); // rad
    const expectedAngle = Math.PI / 4; // 45°
    const tolerance = expectedAngle * 0.1; // ±10% (more lenient)

    expect(tiltAngle).toBeGreaterThan(expectedAngle - tolerance);
    expect(tiltAngle).toBeLessThan(expectedAngle + tolerance);
  });

  // 5. Crash detection near ground
  it('detects crash when moving fast downwards just above ground', () => {
    const state = createQuadState();
    const startPos = new THREE.Vector3(0, 0, 0);
    resetQuad(state, startPos, 0, 0);
    state.armed = true;

    // position almost touching ground (ground plane at groundY + size = 0 + 0.12 = 0.12)
    state.pos.y = 0.12 + 0.001; // 0.121
    state.vel.y = -20; // fast downward

    const input: FlightInput = {
      throttle: 0.5,
      rollRate: 0,
      pitchRate: 0,
      yawRate: 0,
    };

    const crashed = stepQuad(state, input, DEFAULT_PARAMS, dt);
    expect(crashed).toBe(true);
  });
});
