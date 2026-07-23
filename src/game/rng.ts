/** Deterministic PRNG shared by the sim (weapon spread, barrel/bot placement).
 *  Never use Math.random in sim code — replays and `__fpv.step()` tests rely on
 *  every random draw coming from a seeded stream. */
export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded stream whose internal state can be captured and restored —
 *  replays snapshot rng state mid-stream so re-simulation draws the exact
 *  same sequence from that point on. */
export interface StatefulRng {
  (): number;
  /** Internal state BEFORE the next draw (bit-exact). */
  getState(): number;
  setState(s: number): void;
}

/** Same recurrence (and same output sequence for a given seed) as mulberry32,
 *  with the running state exposed for snapshots. */
export function mulberry32Stateful(a: number): StatefulRng {
  const fn = (() => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as StatefulRng;
  fn.getState = () => a;
  fn.setState = (s: number) => {
    a = s | 0;
  };
  return fn;
}
