import { describe, expect, it } from 'vitest';
import { PlayerHealth } from '../playerHealth';

describe('PlayerHealth', () => {
  it('starts at max and floors at 0', () => {
    const h = new PlayerHealth(100);
    expect(h.hp).toBe(100);
    h.damage(30);
    expect(h.hp).toBe(70);
    h.damage(999);
    expect(h.hp).toBe(0);
  });

  it('reports the kill exactly once', () => {
    const h = new PlayerHealth(20);
    expect(h.damage(10)).toBe(false);
    expect(h.damage(10)).toBe(true);   // this hit kills
    expect(h.damage(10)).toBe(false);  // already dead — ignored
    expect(h.hp).toBe(0);
  });

  it('reset restores full hp', () => {
    const h = new PlayerHealth(100);
    h.damage(100);
    h.reset();
    expect(h.hp).toBe(100);
    expect(h.damage(100)).toBe(true); // can die again after respawn
  });
});
