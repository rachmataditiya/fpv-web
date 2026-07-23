/** Merges every shootable-target source (barrels, bots, later: remote drones)
 *  into the single flat ShotTarget[] that Weapon.tick expects, and routes the
 *  flat hit index back to the owning source's onHit handler.
 *
 *  collect() and dispatchHit() must see the same layout: sources keep
 *  fixed-length target arrays (dead entries stay in place with alive=false),
 *  and both walk the sources in registration order. */
import type { ShotTarget } from './weapon';

export interface TargetSource {
  targets: readonly ShotTarget[];
  /** The player's shot hit this source's target at localIndex. */
  onHit(localIndex: number): void;
}

export class TargetRegistry {
  private sources: TargetSource[] = [];
  private flat: ShotTarget[] = [];

  register(src: TargetSource): void {
    this.sources.push(src);
  }

  /** Flattened live view for Weapon.tick. Reuses one array — no per-tick alloc. */
  collect(): readonly ShotTarget[] {
    this.flat.length = 0;
    for (const s of this.sources) {
      for (const t of s.targets) this.flat.push(t);
    }
    return this.flat;
  }

  /** Route Weapon's targetIndex (into the last collect()) back to its source. */
  dispatchHit(globalIndex: number): void {
    let i = globalIndex;
    for (const s of this.sources) {
      if (i < s.targets.length) {
        s.onHit(i);
        return;
      }
      i -= s.targets.length;
    }
  }
}
