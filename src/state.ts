/** App settings — persisted to localStorage 'fpv_settings' on every change. */
import type { WeatherId } from './game/weatherTable';

export type Quality = 'low' | 'med' | 'high';
export type CameraMode = 'fpv' | 'chase';
export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface Settings {
  camera: CameraMode;
  map: string; // 'canyon' | 'valley' | 'custom:<name>'
  uptiltDeg: number;        // FPV camera uptilt, 0–40
  fovDeg: number;           // FPV field of view
  quality: Quality;
  chaseStiffness: number;   // chase-cam spring ω, rad/s (8–20 playable)
  freeFly: boolean;
  /** Enemy bots on BSP war-mode maps (applied on next map load). */
  bots: boolean;
  /** Bot combat difficulty (applied on next map load). */
  botDifficulty: BotDifficulty;
  /** Master audio volume, 0–1 (procedural WebAudio SFX). */
  volume: number;
  /** Killer-POV replay on death (war mode). */
  killcam: boolean;
  /** Weather/time-of-day on BSP maps — gameplay-coupled (bot senses scale). */
  weather: WeatherId;
  /** Player drone accent color (garage). */
  accent: number;
  bestLapMsByTrack: Record<string, number>;
}

export const DEFAULT_SETTINGS: Settings = {
  camera: 'fpv',
  map: 'valley', // default = cinematic free-fly, not the race track
  uptiltDeg: 25,
  fovDeg: 120,
  quality: 'med',
  chaseStiffness: 10,
  freeFly: false,
  bots: true,
  botDifficulty: 'normal',
  volume: 0.5, // matches the Sfx master-gain default users have been hearing
  killcam: true,
  weather: 'clear_day',
  accent: 0xff8800,
  bestLapMsByTrack: {},
};

const LS_KEY = 'fpv_settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* quota/private mode */ }
}
