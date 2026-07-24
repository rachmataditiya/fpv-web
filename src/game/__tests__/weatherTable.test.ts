import { describe, it, expect } from 'vitest';
import {
  WEATHER_IDS,
  WEATHERS,
  scaledVision,
  scaledHearing,
} from '../weatherTable';

describe('Weather Table', () => {
  it('contains a spec for every defined weather id', () => {
    for (const id of WEATHER_IDS) {
      expect(WEATHERS[id]).toBeDefined();
    }
  });

  it('has visibilityFactors in [0.3, 1.0] for all weathers', () => {
    for (const id of WEATHER_IDS) {
      const vf = WEATHERS[id].visibilityFactor;
      expect(vf).toBeGreaterThanOrEqual(0.3);
      expect(vf).toBeLessThanOrEqual(1.0);
    }
  });

  it('vision scaling respects reducing visibility order', () => {
    const base = 60;
    const dustStorm = scaledVision(base, 'dust_storm');
    const fog = scaledVision(base, 'fog');
    const clear = scaledVision(base, 'clear_day');

    expect(dustStorm).toBeLessThan(fog);
    expect(fog).toBeLessThan(clear);
  });

  it('hearing scaling boosts night hearing above base', () => {
    const base = 40;
    const nightHearing = scaledHearing(base, 'night');
    expect(nightHearing).toBeGreaterThan(base);
  });

  it('dust_storm has the smallest visibilityFactor', () => {
    const factors = WEATHER_IDS.map((id) => ({
      id,
      vf: WEATHERS[id].visibilityFactor,
    }));
    const min = Math.min(...factors.map((f) => f.vf));
    const dust = factors.find((f) => f.id === 'dust_storm')!;
    expect(dust.vf).toBe(min);
  });

  it('all weather labels are non-empty strings', () => {
    for (const id of WEATHER_IDS) {
      const label = WEATHERS[id].label;
      expect(typeof label).toBe('string');
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it('sun altitude is a reasonable angle (-10 to 90 degrees)', () => {
    for (const id of WEATHER_IDS) {
      const alt = WEATHERS[id].sunAltitudeDeg;
      expect(alt).toBeGreaterThanOrEqual(-10);
      expect(alt).toBeLessThanOrEqual(90);
    }
  });
});
