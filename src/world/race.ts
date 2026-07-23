/** Race state machine: idle → countdown → racing (laps). Driven from the fixed
 *  physics tick with SIM time (accumulated dt), so pausing the loop freezes lap
 *  timing and gate detection for free — no wall-clock anywhere.
 *
 *  Lap protocol: gates are crossed strictly in order. The lap clock starts on the
 *  first crossing of gate 0 (start/finish) after GO; each later gate-0 crossing
 *  closes a lap. A lap only counts if every gate was taken in order (the state
 *  machine can't advance otherwise, so any completed lap is valid by construction). */
import * as THREE from 'three';
import { gateCrossing, gateFrame, outOfBounds } from './track';
import type { GateFrame, TrackDef } from './track';

export type RacePhase = 'idle' | 'countdown' | 'racing';

export interface Checkpoint {
  pos: THREE.Vector3;
  yawDeg: number;
}

export type RaceEvent =
  | { type: 'go' }
  | { type: 'gate'; index: number }
  | { type: 'sector'; index: number; ms: number }
  | { type: 'lap'; ms: number; best: boolean }
  | { type: 'oob' };

const COUNTDOWN_S = 3;

export class Race {
  readonly track: TrackDef;
  private frames: GateFrame[];
  phase: RacePhase = 'idle';
  /** Next gate index to cross (race order). */
  nextGate = 0;
  /** Completed laps. */
  lap = 0;
  private simTime = 0;          // s, accumulated from ticks
  private countdownEnd = 0;
  private lapStart: number | null = null;
  private sectorStart = 0;
  private sectorIdx = 0;
  lastLapMs: number | null = null;
  bestLapMs: number | null = null;
  checkpoint: Checkpoint;

  onEvent: ((e: RaceEvent) => void) | null = null;

  constructor(track: TrackDef, bestLapMs: number | null) {
    this.track = track;
    this.frames = track.gates.map(gateFrame);
    this.bestLapMs = bestLapMs;
    this.checkpoint = { pos: new THREE.Vector3(...track.spawn.pos), yawDeg: track.spawn.yawDeg };
  }

  /** Seconds left in countdown (0 when not counting). */
  countdownLeft(): number | null {
    return this.phase === 'countdown' ? Math.max(0, this.countdownEnd - this.simTime) : null;
  }

  /** Current running lap time in ms, null before the first gate-0 crossing. */
  currentLapMs(): number | null {
    return this.phase === 'racing' && this.lapStart !== null ? (this.simTime - this.lapStart) * 1000 : null;
  }

  start(): void {
    this.phase = 'countdown';
    this.countdownEnd = this.simTime + COUNTDOWN_S;
    this.nextGate = 0;
    this.lap = 0;
    this.lapStart = null;
    this.sectorIdx = 0;
    this.lastLapMs = null;
    this.checkpoint.pos.set(...this.track.spawn.pos);
    this.checkpoint.yawDeg = this.track.spawn.yawDeg;
  }

  reset(): void {
    this.phase = 'idle';
    this.nextGate = 0;
    this.lap = 0;
    this.lapStart = null;
    this.checkpoint.pos.set(...this.track.spawn.pos);
    this.checkpoint.yawDeg = this.track.spawn.yawDeg;
  }

  /** One physics tick. prev/curr = quad position before/after the step. */
  update(dt: number, prev: THREE.Vector3, curr: THREE.Vector3): void {
    this.simTime += dt;

    if (this.phase === 'countdown' && this.simTime >= this.countdownEnd) {
      this.phase = 'racing';
      this.onEvent?.({ type: 'go' });
    }
    if (this.phase !== 'racing') return;

    if (outOfBounds(this.track, curr)) {
      this.onEvent?.({ type: 'oob' });
      return;
    }

    const frame = this.frames[this.nextGate];
    if (!gateCrossing(frame, prev, curr)) return;

    const crossed = this.nextGate;
    const gate = this.track.gates[crossed];
    // Checkpoint = the gate just passed, heading = gate normal direction.
    this.checkpoint.pos.copy(frame.center);
    this.checkpoint.yawDeg = gate.yawDeg;

    if (crossed === 0) {
      if (this.lapStart !== null) {
        const ms = (this.simTime - this.lapStart) * 1000;
        this.lap++;
        this.lastLapMs = ms;
        const best = this.bestLapMs === null || ms < this.bestLapMs;
        if (best) this.bestLapMs = ms;
        this.onEvent?.({ type: 'lap', ms, best });
      }
      this.lapStart = this.simTime;
      this.sectorStart = this.simTime;
      this.sectorIdx = 0;
    } else if (this.sectorIdx < this.track.sectorEnds.length && crossed === this.track.sectorEnds[this.sectorIdx]) {
      this.onEvent?.({ type: 'sector', index: this.sectorIdx, ms: (this.simTime - this.sectorStart) * 1000 });
      this.sectorStart = this.simTime;
      this.sectorIdx++;
    }

    this.onEvent?.({ type: 'gate', index: crossed });
    this.nextGate = (crossed + 1) % this.track.gates.length;
  }
}
