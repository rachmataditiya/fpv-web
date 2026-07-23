/** Difficulty scaling of bot combat tuning. Pure: returns a scaled snapshot,
 *  never mutates the base TUNING blocks. Snapshots are taken at BotManager
 *  construction, so a change applies on the next map load / respawn. */
import type { BotDifficulty } from '../../state';
import type { MutableTuning } from './types';

/** reactions / aim-error / damage multipliers per level. */
const SCALE: Record<BotDifficulty, { reaction: number; aimErr: number; damage: number }> = {
  easy: { reaction: 1.6, aimErr: 1.6, damage: 0.7 },
  normal: { reaction: 1, aimErr: 1, damage: 1 },
  hard: { reaction: 0.6, aimErr: 0.6, damage: 1.3 },
};

export function applyDifficulty<T extends object>(tuning: T, level: BotDifficulty): MutableTuning<T> {
  const s = SCALE[level];
  const out = { ...(tuning as Record<string, number>) };
  out.reactionS *= s.reaction;
  out.aimErrBase *= s.aimErr;
  out.aimErrMin *= s.aimErr;
  out.aimErrPerMeter *= s.aimErr;
  out.aimErrPerSpeed *= s.aimErr;
  out.damage *= s.damage;
  return out as unknown as MutableTuning<T>;
}
