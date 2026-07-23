/** Per-device calibration/mapping profiles — localStorage 'fpv_input_profiles',
 *  keyed by NormalizedInput.id. Pattern ported from gamepad.js (load/save/seed/
 *  migrate + export/import that MERGES by device id so a shared file doesn't wipe
 *  local profiles). Persist on every change; no explicit save button. */
import type { Action, AxisMap, Profile } from './types';
import { ACTIONS } from './types';

const LS = 'fpv_input_profiles';

const RATE_AXIS = (rate: number): AxisMap => ({ axis: null, invert: false, deadzone: 0.05, expo: 0.25, rate });

function baseProfile(): Profile {
  return {
    enabled: true,
    axcal: {},
    axes: {
      roll: RATE_AXIS(667),      // Betaflight-ish racer defaults, deg/s
      pitch: RATE_AXIS(667),
      yaw: RATE_AXIS(400),
      throttle: { axis: null, invert: false, deadzone: 0.02, expo: 0 },
    },
    buttons: {
      arm: null, respawn: null, camera: null, pause: null, shoot: null, restart: null,
      weapon1: null, weapon2: null, weapon3: null, weaponNext: null,
    },
  };
}

/** Device-specific seeds so a fresh controller flies before any calibration.
 *  DJI RC report order: roll=ax0, pitch=ax1, throttle=ax2, yaw=ax3 (HID source
 *  already normalizes signs to up/right = +). Gamepad Mode-2: left stick =
 *  throttle(ax1)/yaw(ax0), right stick = roll(ax2)/pitch(ax3), signs normalized
 *  by the source. Keyboard source emits [roll,pitch,throttle,yaw] directly. */
function seedFor(id: string): Profile {
  const p = baseProfile();
  if (id.startsWith('DJI RC')) {
    p.axes.roll.axis = 0;
    p.axes.pitch.axis = 1;
    p.axes.throttle.axis = 2;
    p.axes.yaw.axis = 3;
    p.buttons.arm = 1; // C1 button (byte-0 bit 1); bit 4 rests HIGH — never seed it
    p.buttons.shoot = 2; // C2 button (bit 2)
    p.buttons.restart = 5; // record/shutter button (bit 5)
    p.buttons.weaponNext = 3; // left-center switch (bit 3) — momentary in one position
  } else if (id === 'keyboard') {
    p.axes.roll.axis = 0;
    p.axes.pitch.axis = 1;
    p.axes.throttle.axis = 2;
    p.axes.yaw.axis = 3;
    p.axes.roll.expo = 0;      // keyboard ramp is already gentle
    p.axes.pitch.expo = 0;
    p.axes.roll.rate = 400;    // full-rate 667°/s is unflyable on binary keys
    p.axes.pitch.rate = 400;
    p.axes.yaw.rate = 220;
    p.buttons = {
      arm: 0, respawn: 1, camera: 2, pause: 3, shoot: 4, restart: 5, // Space=shoot, Backspace=restart
      weapon1: 6, weapon2: 7, weapon3: 8, weaponNext: 9, // Digit1/2/3, KeyQ
    };
  } else {
    // Generic gamepad (Mode-2)
    p.axes.roll.axis = 2;
    p.axes.pitch.axis = 3;
    p.axes.throttle.axis = 1;
    p.axes.yaw.axis = 0;
    p.buttons = { arm: 0, respawn: 1, camera: 3, pause: 9, shoot: 7, restart: 8, weapon1: null, weapon2: null, weapon3: null, weaponNext: 5 }; // RT=shoot, Back=restart, RB=next weapon
  }
  return p;
}

type Store = Record<string, Profile>;

function loadAll(): Store {
  try {
    return (JSON.parse(localStorage.getItem(LS) ?? '{}') as Store) || {};
  } catch {
    return {};
  }
}

function saveAll(m: Store): void {
  try {
    localStorage.setItem(LS, JSON.stringify(m));
  } catch {
    /* quota/private mode */
  }
}

/** Get (and lazily seed + migrate) the profile for a device id. */
export function profileFor(id: string): Profile {
  const m = loadAll();
  if (!m[id]) {
    m[id] = seedFor(id);
    saveAll(m);
  }
  // migrate: ensure every function/action key exists (schema growth safe)
  const base = seedFor(id);
  const p = m[id];
  p.axes = { ...base.axes, ...p.axes };
  for (const k of Object.keys(base.axes) as (keyof Profile['axes'])[])
    p.axes[k] = { ...base.axes[k], ...p.axes[k] };
  const btns = {} as Record<Action, number | null>;
  for (const a of ACTIONS) btns[a] = p.buttons?.[a] ?? base.buttons[a];
  p.buttons = btns;
  if (!p.axcal) p.axcal = {};
  return p;
}

export function saveProfile(id: string, p: Profile): void {
  const m = loadAll();
  m[id] = p;
  saveAll(m);
}

export function resetProfile(id: string): Profile {
  const m = loadAll();
  delete m[id];
  saveAll(m);
  return profileFor(id);
}

/** Export all profiles as a downloadable JSON blob string. */
export function exportProfiles(): string {
  return JSON.stringify(loadAll(), null, 2);
}

/** Import: merge by device id (imported ids win). Throws on invalid JSON/shape. */
export function importProfiles(json: string): void {
  const data = JSON.parse(json) as unknown;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('not a profile file');
  saveAll({ ...loadAll(), ...(data as Store) });
}
