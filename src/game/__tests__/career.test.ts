import { describe, it, expect } from "vitest";
import { Career, MatchSummary } from "../career";

class MockStorage implements Pick<Storage, "getItem" | "setItem"> {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

const defaultMatch: MatchSummary = {
  missionId: null,
  won: true,
  timeS: 120,
  kills: 3,
  deaths: 1,
  shotsFired: 30,
  shotsHit: 15,
  killsByClass: { rifleman: 2, sniper: 1 },
  detected: false,
  bestStreak: 2,
};

describe("Career", () => {
  it("XP math: kill +10, win +50", () => {
    const storage = new MockStorage();
    const career = new Career(storage);
    const { xpGained } = career.addMatch({
      ...defaultMatch,
      kills: 3,
      won: true,
      bestStreak: 2,
      shotsFired: 30,
      shotsHit: 15,
      missionId: null,
    });
    expect(xpGained).toBe(3 * 10 + 50);
    expect(career.data.xp).toBe(80);
    expect(career.data.matches).toBe(1);
  });

  it("rank progression: crosses threshold", () => {
    const storage = new MockStorage();
    const career = new Career(storage);
    career.addMatch({ ...defaultMatch, kills: 20, won: true, missionId: null });
    const rank1 = career.rank();
    expect(rank1.level).toBe(2);
    expect(rank1.name).toBe("Rotor Scout");
    expect(rank1.progress01).toBeCloseTo((250 - 100) / (300 - 100), 2);

    career.addMatch({ ...defaultMatch, kills: 10, won: true, missionId: null });
    const rank2 = career.rank();
    expect(rank2.level).toBe(3);
    expect(rank2.name).toBe("Lift Operator");
    expect(rank2.nextXp).toBe(700);
  });

  it("medals positive: ace (streak >=5)", () => {
    const career = new Career(new MockStorage());
    const { xpGained, newMedals } = career.addMatch({
      ...defaultMatch,
      bestStreak: 5,
      won: false,
      missionId: null,
    });
    expect(newMedals.length).toBe(1);
    expect(newMedals[0].id).toBe("ace");
    expect(xpGained).toBe(3 * 10 + 0 + 100);
    expect(career.data.medals).toContain("ace");
  });

  it("medals positive: ghost (win, not detected, missionId not null)", () => {
    const career = new Career(new MockStorage());
    const { newMedals } = career.addMatch({
      ...defaultMatch,
      won: true,
      detected: false,
      missionId: "M02",
      bestStreak: 1,
      shotsFired: 10,
      shotsHit: 3,
      killsByClass: { rifleman: 1 },
    });
    expect(newMedals.map((m) => m.id)).toContain("ghost");
    expect(career.data.medals).toContain("ghost");
  });

  it("medals positive: marksman (>60% accuracy, 20+ shots)", () => {
    const career = new Career(new MockStorage());
    const { newMedals } = career.addMatch({
      ...defaultMatch,
      shotsFired: 25,
      shotsHit: 17,
      won: false,
      missionId: null,
      bestStreak: 1,
      killsByClass: { rifleman: 1 },
    });
    expect(newMedals.map((m) => m.id)).toContain("marksman");
    expect(career.data.medals).toContain("marksman");
  });

  it("medals positive: exterminator (kill all 4 classes in one match)", () => {
    const career = new Career(new MockStorage());
    const { newMedals } = career.addMatch({
      missionId: null,
      won: true,
      timeS: 120,
      kills: 4,
      deaths: 1,
      shotsFired: 30,
      shotsHit: 15,
      killsByClass: { rifleman: 1, sniper: 1, heavy: 1, scout: 1 },
      detected: false,
      bestStreak: 1,
    });
    expect(newMedals.map((m) => m.id)).toContain("exterminator");
    expect(career.data.medals).toContain("exterminator");
  });

  it("medals negative: streak < 5 does not unlock ace", () => {
    const career = new Career(new MockStorage());
    const { newMedals } = career.addMatch({ ...defaultMatch, bestStreak: 4, missionId: null });
    expect(newMedals.map((m) => m.id)).not.toContain("ace");
  });

  it("medals negative: ghost fails if detected or no win or free war", () => {
    const career = new Career(new MockStorage());
    let res = career.addMatch({
      ...defaultMatch,
      won: true,
      detected: true,
      missionId: "M03",
      bestStreak: 1,
      shotsFired: 10,
      shotsHit: 3,
      killsByClass: { rifleman: 1 },
    });
    expect(res.newMedals.map((m) => m.id)).not.toContain("ghost");
    
    res = career.addMatch({
      missionId: null,
      won: true,
      timeS: 120,
      kills: 3,
      deaths: 1,
      shotsFired: 10,
      shotsHit: 3,
      killsByClass: { rifleman: 1 },
      detected: false,
      bestStreak: 1,
    });
    expect(res.newMedals.map((m) => m.id)).not.toContain("ghost");
  });

  it("medals negative: marksman needs >60% accuracy, not equal", () => {
    const career = new Career(new MockStorage());
    const res = career.addMatch({
      missionId: null,
      won: true,
      timeS: 120,
      kills: 3,
      deaths: 1,
      shotsFired: 20,
      shotsHit: 12,
      killsByClass: { rifleman: 1 },
      detected: false,
      bestStreak: 1,
    });
    expect(res.newMedals.map((m) => m.id)).not.toContain("marksman");
  });

  it("medals negative: exterminator needs all four classes", () => {
    const career = new Career(new MockStorage());
    const res = career.addMatch({
      missionId: null,
      won: true,
      timeS: 120,
      kills: 3,
      deaths: 1,
      shotsFired: 10,
      shotsHit: 3,
      killsByClass: { rifleman: 1, sniper: 1, heavy: 1 },
      detected: false,
      bestStreak: 1,
    });
    expect(res.newMedals.map((m) => m.id)).not.toContain("exterminator");
  });

  it("no double-unlock for same medal", () => {
    const career = new Career(new MockStorage());
    career.addMatch({ ...defaultMatch, bestStreak: 5, missionId: null });
    expect(career.data.medals.filter((id) => id === "ace").length).toBe(1);
    
    const { xpGained, newMedals } = career.addMatch({
      ...defaultMatch,
      bestStreak: 6,
      missionId: null,
    });
    expect(newMedals.length).toBe(0);
    expect(xpGained).toBe(defaultMatch.kills * 10 + (defaultMatch.won ? 50 : 0));
    expect(career.data.medals.filter((id) => id === "ace").length).toBe(1);
  });

  it("recentKills FIFO max 10", () => {
    const career = new Career(new MockStorage());
    for (let i = 1; i <= 12; i++) {
      career.addMatch({
        missionId: null,
        won: true,
        timeS: 120,
        kills: i,
        deaths: 1,
        shotsFired: 30,
        shotsHit: 15,
        killsByClass: { rifleman: 2, sniper: 1 },
        detected: false,
        bestStreak: 1,
      });
    }
    expect(career.data.recentKills).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(career.data.recentKills.length).toBe(10);
  });

  it("persist and load: data survives constructor", () => {
    const storage = new MockStorage();
    const career1 = new Career(storage);
    career1.addMatch({ ...defaultMatch, kills: 7, won: false, missionId: null });

    const career2 = new Career(storage);
    expect(career2.data.xp).toBe(career1.data.xp);
    expect(career2.data.kills).toBe(career1.data.kills);
    expect(career2.data.matches).toBe(career1.data.matches);
  });

  it("corrupt JSON returns default without throw", () => {
    const storage = new MockStorage();
    storage.setItem("fpv_career", "---invalid---");
    const career = new Career(storage);
    expect(career.data.xp).toBe(0);
    expect(career.data.matches).toBe(0);
    expect(career.data.kills).toBe(0);
    expect(career.data.medals).toHaveLength(0);
  });

  it("accuracy() returns lifetime accuracy", () => {
    const career = new Career(new MockStorage());
    expect(career.accuracy()).toBe(0);
    career.addMatch({ ...defaultMatch, shotsFired: 100, shotsHit: 35, missionId: null });
    expect(career.accuracy()).toBeCloseTo(0.35);
    career.addMatch({
      missionId: null,
      won: true,
      timeS: 120,
      kills: 3,
      deaths: 1,
      shotsFired: 0,
      shotsHit: 0,
      killsByClass: { rifleman: 2, sniper: 1 },
      detected: false,
      bestStreak: 1,
    });
    expect(career.accuracy()).toBeCloseTo(0.35);
  });

  it("reset() clears all data", () => {
    const storage = new MockStorage();
    const career = new Career(storage);
    career.addMatch({ ...defaultMatch, kills: 10, won: true, missionId: null });
    career.reset();
    expect(career.data.xp).toBe(0);
    expect(career.data.matches).toBe(0);
    expect(career.data.kills).toBe(0);
    expect(career.data.medals).toHaveLength(0);
    
    const career2 = new Career(storage);
    expect(career2.data.xp).toBe(0);
  });
});
