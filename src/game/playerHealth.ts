/** Player hit points for bot combat. Deliberately NOT part of QuadState —
 *  physics stays pure; death routes through the existing crash/respawn path
 *  (quad.crashed + crashTimer) exactly like the barrel blast does. */
export class PlayerHealth {
  hp: number;

  constructor(readonly maxHp = 100) {
    this.hp = maxHp;
  }

  /** Apply damage. Returns true exactly when this call kills the player —
   *  further damage while dead is ignored (no double-death). */
  damage(amount: number): boolean {
    if (this.hp <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    return this.hp === 0;
  }

  reset(): void {
    this.hp = this.maxHp;
  }
}
