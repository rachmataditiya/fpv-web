/** WebHID source for the DJI FPV Remote Controller 3 ("DJI Virtual Joystick").
 *
 *  The RC is a VENDOR-defined HID device (usage page 0xFF00) — the Gamepad API can't
 *  see it; WebHID delivers the raw input report. Layout (see DJI-RC-WEBHID.md,
 *  verified on-device 2026-07-22 + v3rm0n/dji-fpv3 descriptor):
 *
 *    report id 0, 13 bytes, ~60–70 Hz:
 *      bytes 0–2   : 24 buttons, 1 bit each (this RC populates byte 0 only;
 *                    one bit rests HIGH — a latched switch — so learn must edge-detect)
 *      bytes 3–4   : right stick L/R = roll     (axis 0)
 *      bytes 5–6   : right stick U/D = pitch    (axis 1)
 *      bytes 7–8   : left  stick U/D = throttle (axis 2)
 *      bytes 9–10  : left  stick L/R = yaw      (axis 3)
 *      bytes 11–12 : camera dial / gimbal wheel (axis 4)
 *    Each axis: int16 little-endian, two's-complement, logical range ±660.
 *
 *  The vertical sticks report up = POSITIVE (opposite the gamepad convention) — our
 *  NormalizedInput contract is up/right = positive, so pitch/throttle need NO flip
 *  here, but note HID_SIGN below keeps all five axes in contract orientation. */
import type { InputSource, NormalizedInput } from './types';

export const DJI_VID = 0x2ca3;
const FULL = 660;
/** Sign per axis to land on the contract (up/right = +1). The RC's verticals are
 *  already up-positive; horizontals and the wheel are conventional. Identity here —
 *  kept explicit so a firmware variant that flips an axis is a one-line fix. */
const HID_SIGN = [1, 1, 1, 1, 1] as const;

/** Parse one 13-byte input report → axes[5] in −1..1 + buttons[24]. */
export function parseReport(b: Uint8Array): { axes: number[]; buttons: boolean[] } {
  const s16 = (lo: number, hi: number) => {
    const v = b[lo] | (b[hi] << 8);
    return v >= 32768 ? v - 65536 : v;
  };
  const axes = [s16(3, 4), s16(5, 6), s16(7, 8), s16(9, 10), s16(11, 12)]
    .map((v, i) => Math.max(-1, Math.min(1, (HID_SIGN[i] * v) / FULL)));
  const buttons: boolean[] = [];
  for (let byte = 0; byte < 3; byte++)
    for (let i = 0; i < 8; i++) buttons.push(!!((b[byte] >> i) & 1));
  return { axes, buttons };
}

export class HidSource implements InputSource {
  readonly kind = 'hid' as const;
  private device: HIDDevice | null = null;
  private state: NormalizedInput | null = null;
  /** Fires on attach/detach so the UI can refresh. */
  onchange: (() => void) | null = null;

  constructor() {
    if (!HidSource.supported()) return;
    navigator.hid.addEventListener('connect', (e) => {
      if (!this.device && e.device.vendorId === DJI_VID) void this.attach(e.device);
    });
    navigator.hid.addEventListener('disconnect', (e) => {
      if (e.device === this.device) {
        this.device = null;
        this.state = null;
        this.onchange?.();
      }
    });
  }

  static supported(): boolean {
    return 'hid' in navigator;
  }

  /** One-time permission grant — MUST be called from a user gesture (click). */
  async connect(): Promise<boolean> {
    if (!HidSource.supported()) return false;
    try {
      const [d] = await navigator.hid.requestDevice({ filters: [{ vendorId: DJI_VID }] });
      if (d) await this.attach(d);
      return !!d;
    } catch {
      return false;
    }
  }

  /** Silent reconnect on load — no gesture needed once granted. */
  async reconnect(): Promise<void> {
    if (!HidSource.supported()) return;
    try {
      const ds = await navigator.hid.getDevices();
      const d = ds.find((x) => x.vendorId === DJI_VID);
      if (d) await this.attach(d);
    } catch {
      /* ignore */
    }
  }

  private async attach(d: HIDDevice): Promise<void> {
    try {
      if (!d.opened) await d.open();
    } catch {
      return;
    }
    this.device = d;
    const id = `DJI RC (USB · ${d.productName || 'HID'})`;
    d.oninputreport = (e) => {
      const { axes, buttons } = parseReport(new Uint8Array(e.data.buffer));
      this.state = { id, axes, buttons };
    };
    this.state = { id, axes: [0, 0, 0, 0, 0], buttons: new Array(24).fill(false) };
    this.onchange?.();
  }

  connected(): boolean {
    return !!this.device;
  }

  read(): NormalizedInput | null {
    return this.state;
  }
}
