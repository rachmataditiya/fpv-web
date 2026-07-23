import { describe, it, expect } from 'vitest';
import { norm, deadzone, expo, readFunction } from '../calibration';

describe('norm', () => {
  it('identity cal passes through', () => {
    const cal = { lo: -1, hi: 1, center: 0 };
    expect(norm(0.5, cal)).toBeCloseTo(0.5);
    expect(norm(-0.3, cal)).toBeCloseTo(-0.3);
  });
  it('asymmetric: 0.9->1, -0.8->-1, 0.05->0', () => {
    const cal = { lo: -0.8, hi: 0.9, center: 0.05 };
    expect(norm(0.9, cal)).toBeCloseTo(1);
    expect(norm(-0.8, cal)).toBeCloseTo(-1);
    expect(norm(0.05, cal)).toBeCloseTo(0);
  });
  it('clamps: 1.2->1, -1.5->-1', () => {
    const cal = { lo: -0.8, hi: 0.9, center: 0.05 };
    expect(norm(1.2, cal)).toBeCloseTo(1);
    expect(norm(-1.5, cal)).toBeCloseTo(-1);
  });
});

describe('deadzone', () => {
  it('d=0.1: 0.05->0, 1->1, 0.1->0, 0.55->0.5', () => {
    expect(deadzone(0.05, 0.1)).toBeCloseTo(0);
    expect(deadzone(1, 0.1)).toBeCloseTo(1);
    expect(deadzone(0.1, 0.1)).toBeCloseTo(0);
    expect(deadzone(0.55, 0.1)).toBeCloseTo(0.5);
  });
});

describe('expo', () => {
  it('e=0 linear: 0.5->0.5', () => {
    expect(expo(0.5, 0)).toBeCloseTo(0.5);
  });
  it('e=1 cubic: 0.5->0.125', () => {
    expect(expo(0.5, 1)).toBeCloseTo(0.125);
  });
  it('passes ±1', () => {
    [0, 0.5, 1].forEach(e => {
      expect(expo(1, e)).toBeCloseTo(1);
      expect(expo(-1, e)).toBeCloseTo(-1);
    });
  });
});

describe('readFunction', () => {
  it('unmapped axis->0', () => {
    const pad = { id: 'test', axes: [0.5], buttons: [] };
    const map = { axis: null, invert: false, deadzone: 0, expo: 0 };
    expect(readFunction(pad, map, {})).toBe(0);
  });
  it('invert flips sign', () => {
    const pad = { id: 'test', axes: [0.5], buttons: [] };
    const map = { axis: 0, invert: true, deadzone: 0, expo: 0 };
    const axcal = { 0: { lo: -1, hi: 1, center: 0 } };
    expect(readFunction(pad, map, axcal)).toBeCloseTo(-0.5);
  });
  it('full chain', () => {
    const pad = { id: 'test', axes: [0.9], buttons: [] };
    const map = { axis: 0, invert: false, deadzone: 0.1, expo: 0 };
    const axcal = { 0: { lo: -0.8, hi: 0.9, center: 0.05 } };
    expect(readFunction(pad, map, axcal)).toBeCloseTo(1);
  });
});
