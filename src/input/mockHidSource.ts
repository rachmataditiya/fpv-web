import { parseReport } from './hidSource';
import type { NormalizedInput, InputSource } from './types';

type Scenario = 'sweep' | 'hover' | 'circle';

export class MockHidSource implements InputSource {
  readonly kind = 'hid' as const;
  readonly id = 'DJI RC (USB · mock)';

  private _scenario: Scenario;
  private _rollRaw = 0;
  private _pitchRaw = 0;
  private _thrRaw = 0;
  private _yawRaw = 0;
  private _wheelRaw = 0;
  private _buttons: [number, number, number] = [0x10, 0, 0]; // byte0 always 0x10
  private _lastNormalized: NormalizedInput | null = null;

  constructor(scenario: Scenario = 'sweep') {
    this._scenario = scenario;
    this._updateReport();
  }

  setAxesRaw(roll: number, pitch: number, thr: number, yaw: number, wheel: number): void {
    this._rollRaw = this._clamp(roll);
    this._pitchRaw = this._clamp(pitch);
    this._thrRaw = this._clamp(thr);
    this._yawRaw = this._clamp(yaw);
    this._wheelRaw = this._clamp(wheel);
    this._updateReport();
  }

  setButton(bit: number, on: boolean): void {
    if (bit < 0 || bit > 23) return;
    const byteIndex = Math.floor(bit / 8);
    const mask = 1 << (bit % 8);
    if (on) {
      this._buttons[byteIndex] |= mask;
    } else {
      this._buttons[byteIndex] &= ~mask;
    }
    // byte0 always keeps 0x10 set
    this._buttons[0] |= 0x10;
    this._updateReport();
  }

  read(): NormalizedInput | null {
    return this._lastNormalized;
  }

  tick(nowMs: number): void {
    this._applyScenario(nowMs);
    this._updateReport();
  }

  private _applyScenario(nowMs: number): void {
    switch (this._scenario) {
      case 'sweep': {
        // stick axes 0.1–0.23 Hz, ±640; wheel 0.05 Hz, ±500
        const t = nowMs * 0.001;
        const twoPi = 2 * Math.PI;
        this._rollRaw = this._clamp(Math.sin(twoPi * 0.1 * t) * 640);
        this._pitchRaw = this._clamp(Math.sin(twoPi * 0.15 * t) * 640);
        this._thrRaw = this._clamp(Math.sin(twoPi * 0.2 * t) * 640);
        this._yawRaw = this._clamp(Math.sin(twoPi * 0.23 * t) * 640);
        this._wheelRaw = this._clamp(Math.sin(twoPi * 0.05 * t) * 500);
        // button bit 1 (0x02) pulse every 4s, 300ms on
        const pulseOn = (nowMs % 4000) < 300;
        this._buttons[0] = 0x10 | (pulseOn ? 0x02 : 0);
        this._buttons[1] = 0;
        this._buttons[2] = 0;
        break;
      }
      case 'hover': {
        // throttle ≈+180 with ±8 noise, others ±5 jitter centered
        this._rollRaw = this._clamp((Math.random() * 10) - 5);
        this._pitchRaw = this._clamp((Math.random() * 10) - 5);
        this._yawRaw = this._clamp((Math.random() * 10) - 5);
        this._wheelRaw = this._clamp((Math.random() * 10) - 5);
        this._thrRaw = this._clamp(180 + (Math.random() * 16) - 8);
        this._buttons[0] = 0x10;
        this._buttons[1] = 0;
        this._buttons[2] = 0;
        break;
      }
      case 'circle': {
        // throttle +200, roll sine ±300 at 0.25 Hz, pitch +250 constant
        const t = nowMs * 0.001;
        const twoPi = 2 * Math.PI;
        this._rollRaw = this._clamp(Math.sin(twoPi * 0.25 * t) * 300);
        this._pitchRaw = this._clamp(250);
        this._thrRaw = this._clamp(200);
        this._yawRaw = 0;
        this._wheelRaw = 0;
        this._buttons[0] = 0x10;
        this._buttons[1] = 0;
        this._buttons[2] = 0;
        break;
      }
    }
  }

  private _updateReport(): void {
    const buf = new ArrayBuffer(13);
    const view = new DataView(buf);
    // buttons (3 bytes)
    view.setUint8(0, this._buttons[0]);
    view.setUint8(1, this._buttons[1]);
    view.setUint8(2, this._buttons[2]);
    // stick axes (int16-LE, clamped ±660)
    view.setInt16(3, this._rollRaw, true);
    view.setInt16(5, this._pitchRaw, true);
    view.setInt16(7, this._thrRaw, true);
    view.setInt16(9, this._yawRaw, true);
    view.setInt16(11, this._wheelRaw, true);
    const report = new Uint8Array(buf);
    const parsed = parseReport(report);
    this._lastNormalized = {
      id: this.id,
      axes: parsed.axes,
      buttons: parsed.buttons,
    };
  }

  private _clamp(value: number): number {
    return Math.max(-660, Math.min(660, Math.round(value)));
  }
}
