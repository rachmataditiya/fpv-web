/** Fixed-timestep game loop ("Fix Your Timestep"): physics advances in exact
 *  PHYS_DT increments from an accumulator; rendering runs on rAF and receives the
 *  interpolation alpha between the two most recent physics states. Frame time is
 *  clamped so a background-tab hiccup can't spiral the accumulator. */

export const PHYS_HZ = 240;
export const PHYS_DT = 1 / PHYS_HZ;
const MAX_FRAME = 0.25; // s — clamp after tab switches / GC stalls

export interface LoopHooks {
  /** Advance simulation by exactly PHYS_DT. Called 0..n times per frame. */
  simTick(dt: number): void;
  /** Draw. alpha ∈ [0,1) = fraction of a physics step since the last simTick. */
  renderTick(alpha: number, frameDt: number): void;
}

export interface LoopHandle {
  stop(): void;
  /** Pause halts simTick but keeps rendering (menus stay live). */
  setPaused(paused: boolean): void;
  readonly paused: boolean;
}

export function startLoop(hooks: LoopHooks): LoopHandle {
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let running = true;
  let paused = false;

  function frame(now: number): void {
    if (!running) return;
    const frameDt = Math.min(MAX_FRAME, (now - last) / 1000);
    last = now;
    if (!paused) {
      acc += frameDt;
      while (acc >= PHYS_DT) {
        hooks.simTick(PHYS_DT);
        acc -= PHYS_DT;
      }
    }
    hooks.renderTick(paused ? 0 : acc / PHYS_DT, frameDt);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    setPaused(p: boolean) {
      paused = p;
      if (!p) {
        last = performance.now(); // don't integrate the paused wall-time
        acc = 0;
      }
    },
    get paused() {
      return paused;
    },
  };
}
