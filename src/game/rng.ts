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
