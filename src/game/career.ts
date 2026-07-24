export interface MatchSummary {
  missionId: string | null; // null = free war mode session
  won: boolean;
  timeS: number;
  kills: number;
  deaths: number;
  shotsFired: number;
  shotsHit: number;
  killsByClass: Record<string, number>; // rifleman/sniper/heavy/scout
  detected: boolean; // pernah terlihat bot (untuk medal Ghost)
  bestStreak: number; // kill tanpa mati
}

export type MedalId = "ace" | "ghost" | "marksman" | "exterminator";

export interface Medal {
  id: MedalId;
  name: string;
  desc: string;
}

export const MEDALS: Record<MedalId, Medal> = {
  ace: { id: "ace", name: "Ace", desc: "Kill streak 5+" },
  ghost: { id: "ghost", name: "Ghost", desc: "Win a mission without being detected" },
  marksman: { id: "marksman", name: "Marksman", desc: "Match accuracy >60% with 20+ shots" },
  exterminator: { id: "exterminator", name: "Exterminator", desc: "Kill at least one of each class in a match" },
};

export interface RankInfo {
  level: number;
  name: string;
  xp: number;
  nextXp: number | null;
  progress01: number;
}

export interface CareerData {
  xp: number;
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  shotsFired: number;
  shotsHit: number;
  killsByClass: Record<string, number>;
  medals: MedalId[];
  recentKills: number[];
}

function createDefaultCareerData(): CareerData {
  return {
    xp: 0,
    matches: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    shotsFired: 0,
    shotsHit: 0,
    killsByClass: {},
    medals: [],
    recentKills: [],
  };
}

const XP_THRESHOLDS = [0, 100, 300, 700, 1300, 2200, 3500, 5200, 7500, 10500];
const RANK_NAMES = [
  "Prop Cadet",
  "Rotor Scout",
  "Lift Operator",
  "Flight Sergeant",
  "Drone Captain",
  "Wing Commander",
  "Squadron Leader",
  "Air Marshal",
  "Sky General",
  "Sky Marshal",
];

export class Career {
  data: CareerData;
  private storage: Pick<Storage, "getItem" | "setItem">;

  constructor(storage?: Pick<Storage, "getItem" | "setItem">) {
    this.storage = storage ?? localStorage;
    this.data = this.load();
  }

  private load(): CareerData {
    try {
      const raw = this.storage.getItem("fpv_career");
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        // explicitly reconstruct with only known properties, creating new arrays
        return {
          xp: typeof parsed.xp === "number" ? parsed.xp : 0,
          matches: typeof parsed.matches === "number" ? parsed.matches : 0,
          wins: typeof parsed.wins === "number" ? parsed.wins : 0,
          kills: typeof parsed.kills === "number" ? parsed.kills : 0,
          deaths: typeof parsed.deaths === "number" ? parsed.deaths : 0,
          shotsFired: typeof parsed.shotsFired === "number" ? parsed.shotsFired : 0,
          shotsHit: typeof parsed.shotsHit === "number" ? parsed.shotsHit : 0,
          killsByClass:
            typeof parsed.killsByClass === "object" && parsed.killsByClass !== null
              ? (parsed.killsByClass as Record<string, number>)
              : {},
          medals: Array.isArray(parsed.medals) ? [...(parsed.medals as MedalId[])] : [],
          recentKills: Array.isArray(parsed.recentKills) ? [...(parsed.recentKills as number[])] : [],
        };
      }
    } catch {
      // corrupt JSON → default
    }
    return createDefaultCareerData();
  }

  private save(): void {
    this.storage.setItem("fpv_career", JSON.stringify(this.data));
  }

  addMatch(s: MatchSummary): { xpGained: number; newMedals: Medal[] } {
    // update stats
    this.data.matches += 1;
    if (s.won) this.data.wins += 1;
    this.data.kills += s.kills;
    this.data.deaths += s.deaths;
    this.data.shotsFired += s.shotsFired;
    this.data.shotsHit += s.shotsHit;

    // merge killsByClass
    for (const [cls, count] of Object.entries(s.killsByClass)) {
      this.data.killsByClass[cls] = (this.data.killsByClass[cls] ?? 0) + count;
    }

    // update recentKills (FIFO, max 10 items)
    this.data.recentKills.push(s.kills);
    if (this.data.recentKills.length > 10) {
      this.data.recentKills.shift();
    }

    // base XP calculation
    let xpGained = s.kills * 10 + (s.won ? 50 : 0);

    // check medals
    const newMedals: Medal[] = [];
    const matchAccuracy = s.shotsFired > 0 ? s.shotsHit / s.shotsFired : 0;
    const allClassesPresent = this.hasAllFourClasses(s.killsByClass);

    const medalChecks: { id: MedalId; condition: boolean }[] = [
      { id: "ace", condition: s.bestStreak >= 5 },
      { id: "ghost", condition: s.won && !s.detected && s.missionId !== null },
      { id: "marksman", condition: matchAccuracy > 0.6 && s.shotsFired >= 20 },
      { id: "exterminator", condition: allClassesPresent },
    ];

    for (const check of medalChecks) {
      if (check.condition && !this.data.medals.includes(check.id)) {
        this.data.medals.push(check.id);
        newMedals.push(MEDALS[check.id]);
        xpGained += 100;
      }
    }

    // award total XP
    this.data.xp += xpGained;
    this.save();
    return { xpGained, newMedals };
  }

  private hasAllFourClasses(kbc: Record<string, number>): boolean {
    const required = ["rifleman", "sniper", "heavy", "scout"];
    return required.every((c) => (kbc[c] ?? 0) >= 1);
  }

  rank(): RankInfo {
    const xp = this.data.xp;
    let level = 1;
    let nextXp: number | null = null;
    let progress01 = 0;

    for (let i = XP_THRESHOLDS.length - 1; i >= 0; i--) {
      if (xp >= XP_THRESHOLDS[i]) {
        level = i + 1;
        break;
      }
    }

    if (level < XP_THRESHOLDS.length) {
      nextXp = XP_THRESHOLDS[level];
      const currentMin = XP_THRESHOLDS[level - 1];
      const range = nextXp - currentMin;
      progress01 = range > 0 ? Math.min(1, (xp - currentMin) / range) : 1;
    } else {
      nextXp = null;
      progress01 = 1;
    }

    return {
      level,
      name: RANK_NAMES[level - 1],
      xp,
      nextXp,
      progress01,
    };
  }

  accuracy(): number {
    if (this.data.shotsFired === 0) return 0;
    return this.data.shotsHit / this.data.shotsFired;
  }

  reset(): void {
    this.data = createDefaultCareerData();
    this.save();
  }
}
