/** Shared input contracts — every source (WebHID DJI RC, Gamepad API, keyboard, mock)
 *  normalizes to the same shape so calibration/mapping is source-agnostic. */

/** Raw-ish normalized device state. Axes in −1..1 (device sign conventions already
 *  normalized: up/right = positive), buttons as booleans. */
export interface NormalizedInput {
  /** Stable device identity — keys the calibration profile in localStorage. */
  id: string;
  axes: number[];
  buttons: boolean[];
}

/** An input source. Sources keep their own state updated (event-driven or polled);
 *  read() returns the latest snapshot, or null when the device is absent. */
export interface InputSource {
  /** Priority tag: 'hid' > 'gamepad' > 'keyboard'. */
  readonly kind: 'hid' | 'gamepad' | 'keyboard';
  read(): NormalizedInput | null;
}

/** Calibrated, mapped flight command consumed by the physics step.
 *  Rates are SIGNED rad/s targets (full stick = profile rate); throttle 0..1. */
export interface FlightInput {
  rollRate: number;   // + = roll right
  pitchRate: number;  // + = pitch forward (nose down)
  yawRate: number;    // + = yaw right
  throttle: number;   // 0..1 collective
}

/** Mappable button actions (edge-triggered by the InputManager). */
export type Action =
  | 'arm' | 'respawn' | 'camera' | 'pause' | 'shoot' | 'restart'
  | 'weapon1' | 'weapon2' | 'weapon3' | 'weaponNext';
export const ACTIONS: readonly Action[] = [
  'arm', 'respawn', 'camera', 'pause', 'shoot', 'restart',
  'weapon1', 'weapon2', 'weapon3', 'weaponNext',
];

/** Per-function axis mapping (function → physical axis + response curve). */
export interface AxisMap {
  axis: number | null;
  invert: boolean;
  deadzone: number;      // 0..0.5
  expo: number;          // 0..1  (0 = linear, 1 = cubic)
  rate?: number;         // deg/s at full deflection (roll/pitch/yaw only)
  limit?: number;        // throttle only: output scale 0.5..1 (Betaflight-style throttle limit)
}

/** Hardware calibration for one physical axis index (captured travel). */
export interface AxisCal { lo: number; hi: number; center: number }

/** Per-device profile — localStorage 'fpv_input_profiles', keyed by NormalizedInput.id. */
export interface Profile {
  enabled: boolean;
  axcal: Record<number, AxisCal>;
  axes: { roll: AxisMap; pitch: AxisMap; yaw: AxisMap; throttle: AxisMap };
  buttons: Record<Action, number | null>;
}
