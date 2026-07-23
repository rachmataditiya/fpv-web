/** The ONE normalized input layer. Picks the active source by priority
 *  (HID DJI RC > gamepad > keyboard), applies the device's calibration profile,
 *  and yields the FlightInput consumed by physics plus edge-triggered actions.
 *
 *  Sources keep themselves fresh (event-driven or externally ticked — main.ts
 *  drives KeyboardSource/MockHidSource ticks); this class only reads. */
import { readFunction } from './calibration';
import { profileFor } from './profiles';
import type { Action, FlightInput, InputSource, NormalizedInput, Profile } from './types';
import { ACTIONS } from './types';

const DEG2RAD = Math.PI / 180;

export class InputManager {
  private sources: InputSource[];
  private profile: Profile | null = null;
  private profileId: string | null = null;
  private prevBtn: Record<Action, boolean> = { arm: false, respawn: false, camera: false, pause: false, shoot: false };
  private out: FlightInput = { rollRate: 0, pitchRate: 0, yawRate: 0, throttle: 0 };

  /** Fired on a mapped button's unpressed→pressed edge. */
  onAction: ((a: Action) => void) | null = null;

  constructor(sources: InputSource[]) {
    // priority order: hid first, keyboard last
    const rank = { hid: 0, gamepad: 1, keyboard: 2 } as const;
    this.sources = [...sources].sort((a, b) => rank[a.kind] - rank[b.kind]);
  }

  /** Highest-priority source with a live device. */
  activePad(): NormalizedInput | null {
    for (const s of this.sources) {
      const pad = s.read();
      if (pad) return pad;
    }
    return null;
  }

  /** The profile bound to the active device (auto-seeds new devices). */
  activeProfile(): Profile | null {
    const pad = this.activePad();
    if (!pad) return null;
    if (this.profileId !== pad.id) this.applyProfile(pad.id);
    return this.profile;
  }

  /** (Re)load a device profile from storage — call after the wizard closes. */
  applyProfile(id?: string): void {
    const pid = id ?? this.profileId;
    if (!pid) return;
    this.profileId = pid;
    this.profile = profileFor(pid);
  }

  /** Is a mapped action button currently held? (For auto-fire etc.) */
  held(a: Action): boolean {
    const pad = this.activePad();
    const prof = this.activeProfile();
    if (!pad || !prof) return false;
    const idx = prof.buttons[a];
    return idx != null && !!pad.buttons[idx];
  }

  /** Sample once per physics tick: fires action edges, returns the flight command. */
  sample(): FlightInput {
    const pad = this.activePad();
    const prof = this.activeProfile();
    if (!pad || !prof || !prof.enabled) {
      this.out.rollRate = this.out.pitchRate = this.out.yawRate = 0;
      this.out.throttle = 0;
      return this.out;
    }

    // Edge-triggered actions (unpressed → pressed only — the DJI rest-high bit
    // can never fire because it starts pressed).
    for (const a of ACTIONS) {
      const idx = prof.buttons[a];
      const pressed = idx != null && !!pad.buttons[idx];
      const fire = pressed && !this.prevBtn[a];
      this.prevBtn[a] = pressed; // update BEFORE the callback — a re-entrant sample() must not re-fire the edge
      if (fire) this.onAction?.(a);
    }

    // Rates: calibrated −1..1 × profile rate (deg/s) → rad/s.
    this.out.rollRate = readFunction(pad, prof.axes.roll, prof.axcal) * (prof.axes.roll.rate ?? 400) * DEG2RAD;
    this.out.pitchRate = readFunction(pad, prof.axes.pitch, prof.axcal) * (prof.axes.pitch.rate ?? 400) * DEG2RAD;
    this.out.yawRate = readFunction(pad, prof.axes.yaw, prof.axcal) * (prof.axes.yaw.rate ?? 400) * DEG2RAD;
    // Throttle: absolute — stick position IS the value, −1..1 → 0..1, then
    // scaled by the profile's throttle limit (tames overpowered quads).
    const t = readFunction(pad, prof.axes.throttle, prof.axcal);
    this.out.throttle = Math.max(0, Math.min(1, (t + 1) / 2)) * (prof.axes.throttle.limit ?? 1);
    return this.out;
  }
}
