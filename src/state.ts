/** App settings — persisted to localStorage 'fpv_settings' on every change. */
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
