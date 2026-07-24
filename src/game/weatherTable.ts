/**
 * Pure data and math module for weather conditions.
 * No Three.js imports — only numeric data and helper functions.
 */

export type WeatherId = 'clear_day' | 'golden_hour' | 'night' | 'dust_storm' | 'fog';

export const WEATHER_IDS: readonly WeatherId[] = [
  'clear_day',
  'golden_hour',
  'night',
  'dust_storm',
  'fog',
] as const;

export interface WeatherSpec {
  /** scales bot vision ranges AND render fog distance, 0.3–1.0 */
  visibilityFactor: number;
  /** scales bot hearing ranges (night boost = 1.3) */
  hearingFactor: number;
  /** scene fog color (hex) + near/far in meters at factor 1 */
  fogColor: number;
  fogNear: number;
  fogFar: number;
  /** hemisphere sky/ground + directional sun color/intensity */
  skyColor: number;
  groundColor: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  sunAltitudeDeg: number;
  sunAzimuthDeg: number;
  /** background clear color */
  bgColor: number;
  /** emissive boost for tracers/LEDs at night (1 = none) */
  emissiveBoost: number;
  label: string;
}

/**
 * Complete lookup table with all atmospheric parameters.
 * fogNear/fogFar are already the effective values for that weather,
 * no additional visibility scaling is applied to them.
 */
export const WEATHERS: Record<WeatherId, WeatherSpec> = {
  clear_day: {
    visibilityFactor: 1.0,
    hearingFactor: 1.0,
    fogColor: 0x87ceeb,
    fogNear: 0,
    fogFar: 200,
    skyColor: 0x87ceeb,
    groundColor: 0x8b7355,
    hemiIntensity: 0.6,
    sunColor: 0xffffff,
    sunIntensity: 1.0,
    sunAltitudeDeg: 45,
    sunAzimuthDeg: 135,
    bgColor: 0x87ceeb,
    emissiveBoost: 1.0,
    label: 'Clear Day',
  },
  golden_hour: {
    visibilityFactor: 0.9,
    hearingFactor: 1.0,
    fogColor: 0xffa07a,
    fogNear: 5,
    fogFar: 150,
    skyColor: 0xffdab9,
    groundColor: 0xd2691e,
    hemiIntensity: 0.5,
    sunColor: 0xff8c00,
    sunIntensity: 0.8,
    sunAltitudeDeg: 15,
    sunAzimuthDeg: 270,
    bgColor: 0xffdab9,
    emissiveBoost: 1.0,
    label: 'Golden Hour',
  },
  night: {
    visibilityFactor: 0.55,
    hearingFactor: 1.3,
    fogColor: 0x191970,
    fogNear: 2,
    fogFar: 80,
    skyColor: 0x0a0a2e,
    groundColor: 0x1a1a3a,
    hemiIntensity: 0.1,
    sunColor: 0x808080,
    sunIntensity: 0.1,
    sunAltitudeDeg: -5,
    sunAzimuthDeg: 180,
    bgColor: 0x0a0a2e,
    emissiveBoost: 1.8,
    label: 'Night',
  },
  dust_storm: {
    visibilityFactor: 0.35,
    hearingFactor: 1.0,
    fogColor: 0xb8860b,
    fogNear: 1,
    fogFar: 30,
    skyColor: 0xbfa76a,
    groundColor: 0x8b6508,
    hemiIntensity: 0.3,
    sunColor: 0xd2b48c,
    sunIntensity: 0.3,
    sunAltitudeDeg: 20,
    sunAzimuthDeg: 90,
    bgColor: 0xbfa76a,
    emissiveBoost: 1.0,
    label: 'Dust Storm',
  },
  fog: {
    visibilityFactor: 0.5,
    hearingFactor: 1.0,
    fogColor: 0xb0c4de,
    fogNear: 0,
    fogFar: 60,
    skyColor: 0xd3d3d3,
    groundColor: 0x808080,
    hemiIntensity: 0.4,
    sunColor: 0xffffff,
    sunIntensity: 0.5,
    sunAltitudeDeg: 30,
    sunAzimuthDeg: 0,
    bgColor: 0xd3d3d3,
    emissiveBoost: 1.0,
    label: 'Fog',
  },
};

/**
 * Scales a bot's vision range according to the active weather.
 * Multiplies the base range by the weather's visibilityFactor.
 */
export function scaledVision(baseRange: number, w: WeatherId): number {
  return baseRange * WEATHERS[w].visibilityFactor;
}

/**
 * Scales a bot's hearing range according to the active weather.
 * Multiplies the base range by the weather's hearingFactor.
 */
export function scaledHearing(baseRange: number, w: WeatherId): number {
  return baseRange * WEATHERS[w].hearingFactor;
}
