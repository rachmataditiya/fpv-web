/** Calibration math — ported VERBATIM from the proven gamepad.js / DJI-RC-WEBHID.md §6.3.
 *  Chain per mapped function: raw → norm(hardware cal) → deadzone → expo → invert → scale. */
import type { AxisCal, AxisMap, NormalizedInput } from './types';

export const DEFAULT_CAL: AxisCal = { lo: -1, hi: 1, center: 0 };

/** Hardware normalize: raw (−1..1 from the parser) → calibrated −1..1 using captured
 *  travel. Splitting the span at center handles asymmetric / non-self-centering
 *  sticks (the DJI throttle) correctly. */
export function norm(raw: number, cal: AxisCal): number {
  const r = raw - cal.center;
  const span = r >= 0 ? cal.hi - cal.center || 1 : cal.center - cal.lo || 1;
  return Math.max(-1, Math.min(1, r / Math.abs(span)));
}

/** Deadzone with edge-rescale: kills jitter near center but the usable range still
 *  reaches ±1 (a plain cutoff would leave a dead step at the zone edge). */
export function deadzone(v: number, d: number): number {
  return Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d);
}

/** Expo: soften center response, keep full throw. e=0 linear, e=1 cubic; monotonic,
 *  passes through ±1. */
export function expo(v: number, e: number): number {
  return (1 - e) * v + e * v * v * v;
}

/** Full chain for one mapped function → −1..1 (or 0 when unmapped). */
export function readFunction(pad: NormalizedInput, map: AxisMap, axcal: Record<number, AxisCal>): number {
  if (map.axis == null || map.axis >= pad.axes.length) return 0;
  let v = norm(pad.axes[map.axis], axcal[map.axis] ?? DEFAULT_CAL);
  v = deadzone(v, map.deadzone);
  v = expo(v, map.expo);
  return map.invert ? -v : v;
}
