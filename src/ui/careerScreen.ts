import { Career, MEDALS } from "../game/career";

export class CareerScreen {
  private overlay: HTMLDivElement;
  private panel: HTMLDivElement;
  private readonly career: Career;
  private static styleInjected = false;

  constructor(root: HTMLElement, career: Career) {
    this.career = career;
    this.injectStylesOnce();

    this.overlay = document.createElement("div");
    this.overlay.className = "career-overlay";
    this.overlay.style.display = "none";

    this.panel = document.createElement("div");
    this.panel.className = "career-panel";

    // close button
    const closeBtn = document.createElement("span");
    closeBtn.className = "career-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.close();
    });

    const content = document.createElement("div");
    content.className = "career-content";

    this.panel.append(closeBtn, content);
    this.overlay.appendChild(this.panel);

    // close when clicking outside panel
    this.overlay.addEventListener("click", () => this.close());

    root.appendChild(this.overlay);
    this.buildContent(content);
  }

  get isOpen(): boolean {
    return this.overlay.style.display !== "none";
  }

  open(): void {
    this.updateContent();
    this.overlay.style.display = "flex";
  }

  close(): void {
    this.overlay.style.display = "none";
  }

  private updateContent(): void {
    // rank row
    const rankInfo = this.career.rank();
    const rankRow = this.panel.querySelector(".career-rank-row") as HTMLDivElement | null;
    if (rankRow) {
      const badge = rankRow.querySelector(".rank-badge")!;
      badge.textContent = String(rankInfo.level);
      const nameSpan = rankRow.querySelector(".rank-name")!;
      nameSpan.textContent = rankInfo.name;
      const xpBarFill = rankRow.querySelector(".xp-bar-fill") as HTMLDivElement;
      xpBarFill.style.width = `${rankInfo.progress01 * 100}%`;
      const xpLabel = rankRow.querySelector(".xp-label")!;
      xpLabel.textContent = rankInfo.nextXp ? `${rankInfo.xp} / ${rankInfo.nextXp}` : `${rankInfo.xp} (Max)`;
    }

    // stats grid
    const statsGrid = this.panel.querySelector(".career-stats")!;
    statsGrid.innerHTML = "";
    const stats = [
      ["MATCHES", this.career.data.matches.toString()],
      ["WINS", this.career.data.wins.toString()],
      ["KILLS", this.career.data.kills.toString()],
      ["DEATHS", this.career.data.deaths.toString()],
      ["ACCURACY", `${(this.career.accuracy() * 100).toFixed(1)}%`],
    ];
    stats.forEach(([label, value]) => {
      const labelEl = document.createElement("div");
      labelEl.className = "stat-label";
      labelEl.textContent = label;
      const valueEl = document.createElement("div");
      valueEl.className = "stat-value";
      valueEl.textContent = value;
      statsGrid.append(labelEl, valueEl);
    });

    // medals wall
    const medalWall = this.panel.querySelector(".medal-wall")!;
    medalWall.innerHTML = "";
    for (const medal of Object.values(MEDALS)) {
      const unlocked = this.career.data.medals.includes(medal.id);
      const medalEl = document.createElement("div");
      medalEl.className = `medal-item ${unlocked ? "medal-unlocked" : "medal-locked"}`;
      medalEl.title = medal.desc;
      medalEl.textContent = medal.name[0]; // just show first letter or icon
      medalWall.appendChild(medalEl);
    }

    // sparkline
    const canvas = this.panel.querySelector(".spark-canvas") as HTMLCanvasElement | null;
    if (canvas) {
      this.drawSparkline(canvas, this.career.data.recentKills);
    }
  }

  private buildContent(container: HTMLElement): void {
    // Rank row
    const rankRow = document.createElement("div");
    rankRow.className = "career-rank-row";
    const badge = document.createElement("div");
    badge.className = "rank-badge";
    const nameSpan = document.createElement("span");
    nameSpan.className = "rank-name";
    const xpBarWrap = document.createElement("div");
    xpBarWrap.className = "xp-bar-wrap";
    const xpBarFill = document.createElement("div");
    xpBarFill.className = "xp-bar-fill";
    const xpLabel = document.createElement("span");
    xpLabel.className = "xp-label";
    xpBarWrap.appendChild(xpBarFill);
    rankRow.append(badge, nameSpan, xpBarWrap, xpLabel);

    // Stats grid
    const statsGrid = document.createElement("div");
    statsGrid.className = "career-stats";

    // Medal wall
    const medalWall = document.createElement("div");
    medalWall.className = "medal-wall";

    // Sparkline canvas
    const sparkCanvas = document.createElement("canvas");
    sparkCanvas.className = "spark-canvas";
    sparkCanvas.width = 200;
    sparkCanvas.height = 40;

    // Reset button
    const resetBtn = document.createElement("button");
    resetBtn.className = "career-reset-btn";
    resetBtn.textContent = "RESET CAREER";
    resetBtn.addEventListener("click", () => {
      if (window.confirm("Reset all career progress? This cannot be undone.")) {
        this.career.reset();
        this.updateContent();
      }
    });

    // assemble
    container.append(rankRow, statsGrid, medalWall, sparkCanvas, resetBtn);
  }

  private drawSparkline(canvas: HTMLCanvasElement, kills: number[]): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (kills.length < 2) return;

    const maxKill = Math.max(...kills, 1);
    const w = canvas.width;
    const h = canvas.height;
    const points = kills.map((v, i) => {
      const x = (i / (kills.length - 1)) * w;
      const y = h - (v / maxKill) * h;
      return { x, y };
    });

    const amber = getComputedStyle(document.documentElement).getPropertyValue("--amber").trim() || "#f59e0b";
    ctx.strokeStyle = amber;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }

  private injectStylesOnce(): void {
    if (CareerScreen.styleInjected) return;
    CareerScreen.styleInjected = true;

    const style = document.createElement("style");
    style.textContent = `
      .career-overlay {
        position: fixed; inset: 0; z-index: 1000;
        background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
      }
      .career-panel {
        width: 420px; background: var(--panel, #1e1e2f);
        border: 1px solid var(--line2, #3a3a5c);
        border-radius: 12px; padding: 24px;
        font-family: monospace; color: var(--fg, #e0e0e0);
        position: relative; box-shadow: 0 8px 24px rgba(0,0,0,0.6);
      }
      .career-close {
        position: absolute; top: 8px; right: 12px;
        font-size: 18px; cursor: pointer; color: var(--mut, #888);
      }
      .career-rank-row {
        display: flex; align-items: center; gap: 12px; margin-bottom: 16px;
      }
      .rank-badge {
        width: 32px; height: 32px; border-radius: 50%;
        background: var(--amber, #f59e0b); color: #000;
        display: flex; align-items: center; justify-content: center;
        font-weight: bold; font-size: 16px;
      }
      .rank-name {
        font-weight: 600; flex: 1;
      }
      .xp-bar-wrap {
        height: 6px; background: var(--line2, #3a3a5c);
        border-radius: 3px; flex: 1; min-width: 80px;
      }
      .xp-bar-fill {
        height: 100%; background: var(--amber);
        border-radius: 3px; transition: width 0.3s;
      }
      .xp-label {
        font-size: 12px; color: var(--mut); white-space: nowrap;
      }
      .career-stats {
        display: grid; grid-template-columns: 1fr 1fr;
        gap: 8px 16px; margin-bottom: 20px;
      }
      .stat-label {
        text-transform: uppercase; font-size: 11px;
        color: var(--mut); letter-spacing: 0.5px;
      }
      .stat-value {
        text-align: right; font-weight: 600;
      }
      .medal-wall {
        display: flex; gap: 12px; margin-bottom: 16px; justify-content: center;
      }
      .medal-item {
        width: 40px; height: 40px; border-radius: 8px;
        border: 1px solid var(--line2);
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; background: var(--panel);
      }
      .medal-locked {
        opacity: 0.3;
      }
      .spark-canvas {
        display: block; margin: 0 auto 16px;
        border-bottom: 1px solid var(--line2);
      }
      .career-reset-btn {
        display: block; width: 100%; padding: 8px;
        background: transparent; border: 1px solid var(--line2);
        color: var(--fg); font-family: monospace; cursor: pointer;
        text-transform: uppercase; letter-spacing: 1px;
      }
      .career-reset-btn:hover {
        background: rgba(255,255,255,0.05);
      }
    `;
    document.head.appendChild(style);
  }
}
