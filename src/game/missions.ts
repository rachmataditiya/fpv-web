import * as THREE from 'three';

export type MissionType = 'survive_waves' | 'hunt' | 'extract';

export interface MissionDef {
  id: string;
  name: string;
  type: MissionType;
  /** survive_waves */
  waves?: number;
  interWaveS?: number;
  /** hunt: world-space objective points (markers/targets) */
  huntPoints?: [number, number, number][];
  /** extract */
  pickupPoint?: [number, number, number];
  hoverS?: number;
  briefing: string;
}

export type MissionPhase = 'idle' | 'running' | 'won' | 'lost';

export type MissionEvent =
  | { type: 'flash'; msg: string; ms?: number }
  | { type: 'wave-start'; wave: number; total: number }
  | { type: 'objective-done'; index: number; remaining: number }
  | { type: 'won' }
  | { type: 'lost' };

export interface MissionHooks {
  /** survive_waves: (re)arm the bot squad for wave n (1-based), size = 3 + n. */
  spawnWave(wave: number, size: number): void;
  /** hunt: is objective i destroyed? (caller maps points to barrels/targets) */
  isHuntTargetDown(index: number): boolean;
}

export interface MissionCtx {
  playerPos: THREE.Vector3;
  playerAlive: boolean;
  /** total bot kills counter (monotonic) */
  kills: number;
  botsAlive: number;
  /** player died this tick */
  playerDied: boolean;
}

export interface MissionSummary {
  missionId: string;
  won: boolean;
  timeS: number;
  kills: number;
  deaths: number;
}

export class MissionRunner {
  readonly def: MissionDef;
  phase: MissionPhase = 'idle';

  private timeElapsedS = 0;
  private deathCounter = 0;
  private prevPlayerAlive = true;
  private lastKillsSnapshot = 0;

  // survive_waves state
  private currentWave = 0;
  private interWaveDelayLeft = 0;
  private waveActive = false;

  // hunt state
  private huntTargetsDown: boolean[] = [];

  // extract state
  private extractPhase: 'phase1' | 'phase2' = 'phase1';
  private hoverTimeInRadius = 0;
  private readonly _pickupVec = new THREE.Vector3();

  // Event array reuse
  private events: MissionEvent[] = [];

  constructor(
    def: MissionDef,
    private hooks: MissionHooks,
    private spawn: THREE.Vector3
  ) {
    this.def = def;

    // Initialize hunt state
    if (def.type === 'hunt' && def.huntPoints) {
      this.huntTargetsDown = def.huntPoints.map(() => false);
    }
  }

  start(): void {
    if (this.phase !== 'idle') return;
    this.phase = 'running';
    this.timeElapsedS = 0;
    this.deathCounter = 0;
    this.prevPlayerAlive = true;
    this.lastKillsSnapshot = 0;

    if (this.def.type === 'survive_waves') {
      this.currentWave = 1;
      this.interWaveDelayLeft = 0;
      this.waveActive = true;
      const size = 3 + this.currentWave;
      this.hooks.spawnWave(this.currentWave, size);
      this.events.push({ type: 'wave-start', wave: this.currentWave, total: this.def.waves ?? 1 });
    } else if (this.def.type === 'hunt') {
      if (this.def.huntPoints) {
        this.huntTargetsDown = this.def.huntPoints.map(() => false);
      }
    } else if (this.def.type === 'extract') {
      this.extractPhase = 'phase1';
      this.hoverTimeInRadius = 0;
    }
  }

  abort(): void {
    this.phase = 'lost';
  }

  objective(): THREE.Vector3 | null {
    if (this.phase !== 'running') return null;

    if (this.def.type === 'survive_waves') {
      return null;
    } else if (this.def.type === 'hunt') {
      if (!this.def.huntPoints) return null;
      for (let i = 0; i < this.huntTargetsDown.length; i++) {
        if (!this.huntTargetsDown[i]) {
          const pt = this.def.huntPoints[i];
          return new THREE.Vector3(pt[0], pt[1], pt[2]);
        }
      }
      return null;
    } else if (this.def.type === 'extract') {
      if (this.extractPhase === 'phase1') {
        if (!this.def.pickupPoint) return null;
        return new THREE.Vector3(
          this.def.pickupPoint[0],
          this.def.pickupPoint[1],
          this.def.pickupPoint[2]
        );
      } else {
        return this.spawn.clone();
      }
    }

    return null;
  }

  status(ctx: MissionCtx): string {
    if (this.phase !== 'running') return '';

    if (this.def.type === 'survive_waves') {
      return `WAVE ${this.currentWave}/${this.def.waves ?? 1} — ${ctx.botsAlive} HOSTILES`;
    } else if (this.def.type === 'hunt') {
      const downCount = this.huntTargetsDown.filter(d => d).length;
      const total = this.def.huntPoints?.length ?? 0;
      const remaining = total - downCount;
      if (remaining === 0) {
        return 'EXTRACT COMPLETE';
      }
      return `TARGET ${downCount}/${total} — DESTROY`;
    } else if (this.def.type === 'extract') {
      if (this.extractPhase === 'phase1') {
        const dist = ctx.playerPos.distanceTo(
          new THREE.Vector3(
            this.def.pickupPoint?.[0] ?? 0,
            this.def.pickupPoint?.[1] ?? 0,
            this.def.pickupPoint?.[2] ?? 0
          )
        );
        return `EXTRACT — ${Math.floor(dist)} M`;
      } else {
        const dist = ctx.playerPos.distanceTo(this.spawn);
        return `RETURN — ${Math.floor(dist)} M`;
      }
    }

    return '';
  }

  tick(dt: number, ctx: MissionCtx): readonly MissionEvent[] {
    this.events.length = 0;

    if (this.phase !== 'running') {
      return this.events;
    }

    this.timeElapsedS += dt;

    // Edge-detect player death
    if (!ctx.playerAlive && this.prevPlayerAlive) {
      // Player died
      this.deathCounter++;
      if (this.deathCounter >= 3) {
        this.phase = 'lost';
        this.events.push({ type: 'lost' });
        this.prevPlayerAlive = ctx.playerAlive;
        return this.events;
      }
    }
    this.prevPlayerAlive = ctx.playerAlive;

    if (this.def.type === 'survive_waves') {
      this.tickSurviveWaves(dt, ctx);
    } else if (this.def.type === 'hunt') {
      this.tickHunt(ctx);
    } else if (this.def.type === 'extract') {
      this.tickExtract(dt, ctx);
    }

    return this.events;
  }

  private tickSurviveWaves(dt: number, ctx: MissionCtx): void {
    const totalWaves = this.def.waves ?? 1;

    // Check if wave just ended
    if (this.waveActive && ctx.botsAlive === 0) {
      this.waveActive = false;
      this.interWaveDelayLeft = this.def.interWaveS ?? 10;
    }

    // Process inter-wave delay
    if (this.interWaveDelayLeft > 0) {
      this.interWaveDelayLeft -= dt;
      if (this.interWaveDelayLeft <= 0) {
        // Delay expired, spawn next wave or end mission
        if (this.currentWave < totalWaves) {
          this.currentWave++;
          const size = 3 + this.currentWave;
          this.hooks.spawnWave(this.currentWave, size);
          this.events.push({ type: 'wave-start', wave: this.currentWave, total: totalWaves });
          this.waveActive = true;
        } else {
          // All waves complete
          this.phase = 'won';
          this.lastKillsSnapshot = ctx.kills;
          this.events.push({ type: 'won' });
        }
        this.interWaveDelayLeft = 0;
      }
    }
  }

  private tickHunt(ctx: MissionCtx): void {
    if (!this.def.huntPoints) return;

    let allDown = true;

    for (let i = 0; i < this.def.huntPoints.length; i++) {
      if (!this.huntTargetsDown[i]) {
        // Check if this target is now down
        if (this.hooks.isHuntTargetDown(i)) {
          this.huntTargetsDown[i] = true;
          const remaining = this.huntTargetsDown.filter(d => !d).length;
          this.events.push({ type: 'objective-done', index: i, remaining });
        } else {
          allDown = false;
        }
      }
    }

    if (allDown && this.huntTargetsDown.every(d => d)) {
      this.phase = 'won';
      this.lastKillsSnapshot = ctx.kills;
      this.events.push({ type: 'won' });
    }
  }

  private tickExtract(dt: number, ctx: MissionCtx): void {
    if (!this.def.pickupPoint) return;

    // cached — a per-tick Vector3 allocation would violate the sim's zero-alloc rule
    const pickupVec = this._pickupVec.set(
      this.def.pickupPoint[0],
      this.def.pickupPoint[1],
      this.def.pickupPoint[2]
    );

    if (this.extractPhase === 'phase1') {
      const distToPickup = ctx.playerPos.distanceTo(pickupVec);
      if (distToPickup <= 4) {
        this.hoverTimeInRadius += dt;
        const targetHover = this.def.hoverS ?? 3;
        if (this.hoverTimeInRadius >= targetHover) {
          this.extractPhase = 'phase2';
        }
      } else {
        this.hoverTimeInRadius = 0;
      }
    } else if (this.extractPhase === 'phase2') {
      const distToSpawn = ctx.playerPos.distanceTo(this.spawn);
      if (distToSpawn <= 6) {
        this.phase = 'won';
        this.lastKillsSnapshot = ctx.kills;
        this.events.push({ type: 'won' });
      }
    }
  }

  summary(): MissionSummary {
    return {
      missionId: this.def.id,
      won: this.phase === 'won',
      timeS: this.timeElapsedS,
      kills: this.lastKillsSnapshot,
      deaths: this.deathCounter,
    };
  }
}
