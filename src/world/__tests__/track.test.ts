import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { gateFrame, gateCrossing, outOfBounds } from '../track';
import type { GateDef, TrackDef } from '../track';

describe('gateFrame', () => {
  it('returns a frame with normal pointing -Z for yawDeg=0 at origin', () => {
    const gate: GateDef = {
      pos: [0, 0, 0],
      yawDeg: 0,
      size: { w: 10, h: 10 },
    };
    const frame = gateFrame(gate);
    expect(frame.normal.z).toBeCloseTo(-1);
    expect(frame.normal.x).toBeCloseTo(0);
    expect(frame.normal.y).toBeCloseTo(0);
  });
});

describe('gateCrossing', () => {
  const defaultGate: GateDef = {
    pos: [0, 0, 0],
    yawDeg: 0,
    size: { w: 10, h: 10 },
  };

  it('returns true when segment crosses gate along normal (toward -Z) within bounds', () => {
    const frame = gateFrame(defaultGate);
    const prev = new THREE.Vector3(0, 2, 5);
    const curr = new THREE.Vector3(0, 2, -5);
    expect(gateCrossing(frame, prev, curr)).toBe(true);
  });

  it('returns false when segment moves opposite to normal', () => {
    const frame = gateFrame(defaultGate);
    const prev = new THREE.Vector3(0, 2, -5);
    const curr = new THREE.Vector3(0, 2, 5);
    expect(gateCrossing(frame, prev, curr)).toBe(false);
  });

  it('returns false when crossing point is laterally outside gate (halfWidth)', () => {
    const smallGate: GateDef = {
      pos: [0, 0, 0],
      yawDeg: 0,
      size: { w: 5, h: 5 },
    };
    const frame = gateFrame(smallGate);
    const prev = new THREE.Vector3(10, 2, 5);
    const curr = new THREE.Vector3(10, 2, -5);
    // X = 10 is well beyond halfWidth = 2.5
    expect(gateCrossing(frame, prev, curr)).toBe(false);
  });

  it('returns true when crossing point lies exactly on the half-width boundary (<=)', () => {
    const frame = gateFrame(defaultGate);
    const halfW = 5; // width 10 -> half 5
    const prev = new THREE.Vector3(halfW, 2, 5);
    const curr = new THREE.Vector3(halfW, 2, -5);
    expect(gateCrossing(frame, prev, curr)).toBe(true);
  });

  it('handles yawDeg=90 gate with normal pointing -X', () => {
    const gate: GateDef = {
      pos: [0, 0, 0],
      yawDeg: 90,
      size: { w: 10, h: 10 },
    };
    const frame = gateFrame(gate);
    expect(frame.normal.x).toBeCloseTo(-1);
    expect(frame.normal.z).toBeCloseTo(0);
    const prev = new THREE.Vector3(5, 2, 0);
    const curr = new THREE.Vector3(-5, 2, 0);
    // moves along -X, crosses gate plane within width (now Z = 0 is inside)
    expect(gateCrossing(frame, prev, curr)).toBe(true);
  });
});

describe('outOfBounds', () => {
  it('correctly identifies a point outside a track corridor', () => {
    const track: TrackDef = {
      name: 'test',
      spawn: { pos: [0, 0, 0], yawDeg: 0 },
      bounds: {
        min: [-10, 0, -10],
        max: [10, 10, 10],
      },
      gates: [],
      sectorEnds: [],
    };

    const inside = new THREE.Vector3(0, 5, 0);
    const outside = new THREE.Vector3(15, 5, 0);

    expect(outOfBounds(track, inside)).toBe(false);
    expect(outOfBounds(track, outside)).toBe(true);
  });
});
