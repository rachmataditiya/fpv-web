/** In-flight HUD — "pit-wall telemetry" design.
 *
 *  Identity: every number is tabular monospace (race-decoder look); micro-labels
 *  are uppercase with wide tracking; green is live telemetry (OSD heritage),
 *  amber is the race highlight shared with the 3D next-gate color. The signature
 *  element is the top-center TIMING STRIP: big tabular lap clock over a row of
 *  gate pips — one pip per gate, filled as passed, amber on the gate up next.
 *
 *  Performance contract (unchanged): all element refs cached at construction,
 *  update() writes only what changed, no innerHTML after construction. */

export interface HudData {
  armed: boolean;
  throttle: number;        // 0..1
  speedMs: number;         // m/s
  altitudeM: number;
  rollRad: number;         // + = right wing down
  pitchRad: number;        // + = nose up
  lapMs: number | null;    // current running lap time, null when not racing
  lastLapMs: number | null;
  bestLapMs: number | null;
  lap: number;             // current lap number (1-based), 0 before start
  gateIndex: number;       // next gate index (0-based), -1 = no gates
  gateCount: number;
  mode: 'race' | 'freefly';
  camera: 'fpv' | 'chase';
  countdown: number | null;
  message: string | null;
  /** Barrels destroyed (null = no shooting on this map). */
  score: number | null;
  /** Player hit points (null = no bot combat on this map → combat HUD hidden). */
  hp: number | null;
  /** Bots destroyed (null = no bots on this map). */
  kills: number | null;
}

function fmtMs(ms: number): string {
  const t = Math.max(0, Math.floor(ms));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const mil = t % 1000;
  return `${m}:${s.toString().padStart(2, '0')}.${mil.toString().padStart(3, '0')}`;
}

const CSS = `
.hud{position:absolute;inset:0;pointer-events:none;color:var(--fg);
  font-family:system-ui,sans-serif;text-shadow:0 1px 2px rgba(0,0,0,.55)}
.hud .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.hud .lbl{font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--mut)}

/* ---- timing strip (signature) ---- */
.hud-strip{position:absolute;top:14px;left:50%;transform:translateX(-50%);
  display:flex;flex-direction:column;align-items:center;gap:5px;
  padding:8px 18px 9px;border-radius:10px;background:rgba(11,14,20,.55);
  border:1px solid rgba(44,55,80,.55);backdrop-filter:blur(6px)}
.hud-strip .clockrow{display:flex;align-items:baseline;gap:10px}
.hud-strip .lapno{font-size:11px;font-weight:800;letter-spacing:.14em;color:var(--mut)}
.hud-strip .clock{font-size:24px;font-weight:600;letter-spacing:.02em}
.hud-strip .subrow{display:flex;gap:14px;font-size:10.5px;color:var(--mut)}
.hud-strip .subrow b{color:var(--fg);font-weight:600}
.hud-strip .subrow .bestv{color:var(--amber)}
.hud-pips{display:flex;gap:5px;margin-top:1px}
.hud-pips i{width:6px;height:6px;border-radius:2px;background:var(--line2);transition:background .15s}
.hud-pips i.done{background:var(--green)}
.hud-pips i.next{background:var(--amber);box-shadow:0 0 6px var(--amber)}

/* ---- status cluster (top-left) ---- */
.hud-status{position:absolute;top:14px;left:16px;display:flex;flex-direction:column;gap:6px}
.hud-armed{display:flex;align-items:center;gap:7px;padding:5px 10px;border-radius:7px;
  background:rgba(11,14,20,.55);border:1px solid rgba(44,55,80,.55);width:max-content}
.hud-armed .dot{width:8px;height:8px;border-radius:50%;background:var(--warn);box-shadow:0 0 6px var(--warn)}
.hud-armed.on .dot{background:var(--green);box-shadow:0 0 8px var(--green)}
.hud-armed .txt{font-size:10px;font-weight:800;letter-spacing:.16em;color:var(--warn)}
.hud-armed.on .txt{color:var(--green)}
.hud-cam{font-size:9px;font-weight:700;letter-spacing:.18em;color:var(--mut);padding-left:2px}

/* ---- throttle (bottom-left) ---- */
.hud-thr{position:absolute;left:16px;bottom:52px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.hud-thr .val{font-size:15px;font-weight:600;color:var(--green)}
.hud-thr .track{width:10px;height:130px;border-radius:5px;background:rgba(11,14,20,.6);
  border:1px solid rgba(44,55,80,.6);position:relative;overflow:hidden}
.hud-thr .fill{position:absolute;left:0;right:0;bottom:0;height:0;background:var(--green);opacity:.85}
.hud-thr .tick{position:absolute;left:0;right:0;height:1px;background:rgba(233,238,244,.25)}

/* ---- speed / altitude (bottom-right) ---- */
.hud-speed{position:absolute;right:18px;bottom:52px;text-align:right}
.hud-speed .big{font-size:38px;font-weight:650;line-height:1;letter-spacing:-.01em}
.hud-speed .unit{font-size:9px;font-weight:700;letter-spacing:.18em;color:var(--mut);margin-top:2px}
.hud-speed .alt{font-size:13px;color:var(--mut);margin-top:6px}
.hud-speed .alt b{color:var(--fg);font-weight:600}

/* ---- horizon + crosshair (center) ---- */
.hud-horizon{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}

/* ---- score chip (bottom-center) ---- */
.hud-score{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);
  display:none;align-items:center;gap:7px;padding:6px 14px;border-radius:8px;
  background:rgba(11,14,20,.55);border:1px solid rgba(44,55,80,.55)}
.hud-score .n{font-size:16px;font-weight:700;color:var(--amber)}
.hud-score .sep{color:var(--mut);font-size:12px}

/* ---- integrity (player hp, above the throttle column) ---- */
.hud-hp{position:absolute;left:16px;bottom:248px;display:none;flex-direction:column;gap:5px;
  padding:6px 10px;border-radius:8px;background:rgba(11,14,20,.55);
  border:1px solid rgba(44,55,80,.55);width:max-content}
.hud-hp .row{display:flex;align-items:baseline;gap:8px}
.hud-hp .n{font-size:15px;font-weight:600;color:var(--green)}
.hud-hp .track{width:90px;height:6px;border-radius:3px;background:rgba(233,238,244,.12);
  overflow:hidden}
.hud-hp .fill{height:100%;width:100%;background:var(--green);transition:width .15s}
.hud-hp.mid .n{color:var(--amber)}
.hud-hp.mid .fill{background:var(--amber)}
.hud-hp.low .n{color:var(--warn)}
.hud-hp.low .fill{background:var(--warn)}

/* ---- damage vignette (flashed imperatively via pulseDamage) ---- */
.hud-dmg{position:absolute;inset:0;pointer-events:none;opacity:0;
  box-shadow:inset 0 0 120px 30px rgba(255,40,40,.55)}
.hud-dmg.on{animation:huddmg .5s ease-out}
@keyframes huddmg{from{opacity:1}to{opacity:0}}

/* ---- directional hit chevron (orbits screen center toward the shooter) ---- */
.hud-hitdir{position:absolute;top:50%;left:50%;width:0;height:0;pointer-events:none;opacity:0}
.hud-hitdir i{position:absolute;left:0;top:-34vmin;transform:translateX(-50%);
  width:0;height:0;border-left:15px solid transparent;border-right:15px solid transparent;
  border-bottom:20px solid rgba(255,60,50,.9);filter:drop-shadow(0 0 6px rgba(255,40,40,.6))}
.hud-hitdir.on{animation:hudhit .6s ease-out}
@keyframes hudhit{from{opacity:1}to{opacity:0}}

/* ---- kills chip pop (retriggered per kill) ---- */
.hud-score .n.pop{animation:hudpop .45s ease-out}
@keyframes hudpop{0%{transform:scale(1)}35%{transform:scale(1.55);color:var(--fg)}100%{transform:scale(1)}}

/* ---- center overlays ---- */
.hud-count{position:absolute;top:38%;left:50%;transform:translate(-50%,-50%);
  font-size:88px;font-weight:800;color:var(--fg);display:none;
  text-shadow:0 2px 18px rgba(0,0,0,.6)}
.hud-count.go{color:var(--green)}
.hud-msg{position:absolute;top:30%;left:50%;transform:translate(-50%,-50%);
  font-size:20px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:var(--amber);
  padding:8px 22px;border-radius:8px;background:rgba(11,14,20,.5);display:none;
  animation:hudmsg .18s ease-out}
@keyframes hudmsg{from{transform:translate(-50%,-50%) scale(1.12);opacity:0}
  to{transform:translate(-50%,-50%) scale(1);opacity:1}}
`;

export class Hud {
  private container: HTMLDivElement;
  private styleEl: HTMLStyleElement;
  private horizonCanvas: HTMLCanvasElement;
  private horizonCtx: CanvasRenderingContext2D;

  // cached refs
  private armedEl: HTMLDivElement;
  private camEl: HTMLDivElement;
  private lapnoEl: HTMLSpanElement;
  private clockEl: HTMLSpanElement;
  private lastEl: HTMLElement;
  private bestEl: HTMLElement;
  private pipsEl: HTMLDivElement;
  private thrValEl: HTMLDivElement;
  private thrFillEl: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private altEl: HTMLElement;
  private countEl: HTMLDivElement;
  private msgEl: HTMLDivElement;
  private scoreEl: HTMLDivElement;
  private scoreNEl: HTMLSpanElement;
  private killSepEl: HTMLSpanElement;
  private killLblEl: HTMLSpanElement;
  private killsNEl: HTMLSpanElement;
  private hpEl: HTMLDivElement;
  private hpNEl: HTMLSpanElement;
  private hpFillEl: HTMLDivElement;
  private dmgEl: HTMLDivElement;
  private hitDirEl: HTMLDivElement;

  private prev = {
    armed: null as boolean | null,
    throttle: -1,
    speedKmh: -1,
    alt: NaN,
    lapno: '',
    clock: '',
    last: '',
    best: '',
    camera: '',
    pipNext: -2,
    pipCount: -1,
    countdown: '' as string,
    message: null as string | null,
    score: null as number | null,
    hp: NaN as number | null,
    kills: NaN as number | null,
  };

  constructor(mount: HTMLElement) {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);

    this.container = document.createElement('div');
    this.container.className = 'hud';
    this.container.innerHTML = `
      <div class="hud-strip">
        <div class="clockrow">
          <span class="lapno mono" data-r="lapno">LAP –</span>
          <span class="clock mono" data-r="clock">–:––.–––</span>
        </div>
        <div class="subrow mono">
          <span class="lbl">last</span><b data-r="last">–</b>
          <span class="lbl">best</span><b class="bestv" data-r="best">–</b>
        </div>
        <div class="hud-pips" data-r="pips"></div>
      </div>
      <div class="hud-status">
        <div class="hud-armed" data-r="armed"><i class="dot"></i><span class="txt">DISARMED</span></div>
        <div class="hud-cam" data-r="cam">FPV</div>
      </div>
      <div class="hud-thr">
        <div class="val mono" data-r="thrval">0%</div>
        <div class="track"><div class="fill" data-r="thrfill"></div>
          <i class="tick" style="bottom:25%"></i><i class="tick" style="bottom:50%"></i><i class="tick" style="bottom:75%"></i>
        </div>
        <div class="lbl">throttle</div>
      </div>
      <div class="hud-speed">
        <div class="big mono" data-r="speed">0</div>
        <div class="unit">km/h</div>
        <div class="alt mono"><span class="lbl">alt</span> <b data-r="alt">0</b> m</div>
      </div>
      <div class="hud-horizon"><canvas width="220" height="220" data-r="horizon"></canvas></div>
      <div class="hud-dmg" data-r="dmg"></div>
      <div class="hud-hitdir" data-r="hitdir"><i></i></div>
      <div class="hud-hp mono" data-r="hp">
        <div class="row"><span class="lbl">integrity</span><span class="n" data-r="hpn">100</span></div>
        <div class="track"><div class="fill" data-r="hpfill"></div></div>
      </div>
      <div class="hud-score mono" data-r="score"><span class="lbl">barrels</span><span class="n" data-r="scoren">0</span><span class="sep" data-r="killsep">·</span><span class="lbl" data-r="killlbl">kills</span><span class="n" data-r="killsn">0</span></div>
      <div class="hud-count mono" data-r="count"></div>
      <div class="hud-msg" data-r="msg"></div>`;
    mount.appendChild(this.container);

    const $ = <T extends HTMLElement>(k: string) => this.container.querySelector(`[data-r="${k}"]`) as T;
    this.armedEl = $('armed');
    this.camEl = $('cam');
    this.lapnoEl = $('lapno');
    this.clockEl = $('clock');
    this.lastEl = $('last');
    this.bestEl = $('best');
    this.pipsEl = $('pips');
    this.thrValEl = $('thrval');
    this.thrFillEl = $('thrfill');
    this.speedEl = $('speed');
    this.altEl = $('alt');
    this.countEl = $('count');
    this.msgEl = $('msg');
    this.scoreEl = $('score');
    this.scoreNEl = $('scoren');
    this.killSepEl = $('killsep');
    this.killLblEl = $('killlbl');
    this.killsNEl = $('killsn');
    this.hpEl = $('hp');
    this.hpNEl = $('hpn');
    this.hpFillEl = $('hpfill');
    this.dmgEl = $('dmg');
    this.hitDirEl = $('hitdir');
    this.horizonCanvas = this.container.querySelector('[data-r="horizon"]') as HTMLCanvasElement;
    this.horizonCtx = this.horizonCanvas.getContext('2d')!;
  }

  update(d: HudData): void {
    const p = this.prev;

    // armed light
    if (p.armed !== d.armed) {
      p.armed = d.armed;
      this.armedEl.classList.toggle('on', d.armed);
      (this.armedEl.querySelector('.txt') as HTMLElement).textContent = d.armed ? 'ARMED' : 'DISARMED';
    }
    // camera + mode line
    const cam = `${d.camera === 'fpv' ? 'FPV' : 'CHASE'} · ${d.mode === 'race' ? 'RACE' : 'FREE FLY'}`;
    if (p.camera !== cam) {
      p.camera = cam;
      this.camEl.textContent = cam;
    }
    // throttle
    const thr = Math.round(d.throttle * 100);
    if (p.throttle !== thr) {
      p.throttle = thr;
      this.thrValEl.textContent = `${thr}%`;
      this.thrFillEl.style.height = `${thr}%`;
    }
    // speed / altitude
    const kmh = Math.round(d.speedMs * 3.6);
    if (p.speedKmh !== kmh) {
      p.speedKmh = kmh;
      this.speedEl.textContent = String(kmh);
    }
    const alt = Math.round(d.altitudeM);
    if (p.alt !== alt) {
      p.alt = alt;
      this.altEl.textContent = String(alt);
    }
    // timing strip
    const lapno = d.mode === 'race' ? `LAP ${Math.max(d.lap, 0) || '–'}` : 'FREE';
    if (p.lapno !== lapno) {
      p.lapno = lapno;
      this.lapnoEl.textContent = lapno;
    }
    const clock = d.lapMs !== null ? fmtMs(d.lapMs) : '–:––.–––';
    if (p.clock !== clock) {
      p.clock = clock;
      this.clockEl.textContent = clock;
    }
    const last = d.lastLapMs !== null ? fmtMs(d.lastLapMs) : '–';
    if (p.last !== last) {
      p.last = last;
      this.lastEl.textContent = last;
    }
    const best = d.bestLapMs !== null ? fmtMs(d.bestLapMs) : '–';
    if (p.best !== best) {
      p.best = best;
      this.bestEl.textContent = best;
    }
    // gate pips — rebuilt only when the gate count changes, restyled on advance
    if (p.pipCount !== d.gateCount) {
      p.pipCount = d.gateCount;
      p.pipNext = -2;
      this.pipsEl.innerHTML = d.gateCount > 0 ? '<i></i>'.repeat(d.gateCount) : '';
      this.pipsEl.style.display = d.gateCount > 0 ? '' : 'none';
    }
    if (d.gateCount > 0 && p.pipNext !== d.gateIndex) {
      p.pipNext = d.gateIndex;
      const pips = this.pipsEl.children;
      for (let i = 0; i < pips.length; i++) {
        // pips before the next gate (in lap order) are done; wrap handled by lap reset
        const cls = i === d.gateIndex ? 'next' : i < d.gateIndex ? 'done' : '';
        (pips[i] as HTMLElement).className = cls;
      }
    }

    if (p.score !== d.score) {
      p.score = d.score;
      this.scoreEl.style.display = d.score !== null ? 'flex' : 'none';
      if (d.score !== null) this.scoreNEl.textContent = String(d.score);
    }
    if (p.kills !== d.kills) {
      p.kills = d.kills;
      const show = d.kills !== null ? '' : 'none';
      this.killSepEl.style.display = show;
      this.killLblEl.style.display = show;
      this.killsNEl.style.display = show;
      if (d.kills !== null) this.killsNEl.textContent = String(d.kills);
    }
    if (p.hp !== d.hp) {
      p.hp = d.hp;
      this.hpEl.style.display = d.hp !== null ? 'flex' : 'none';
      if (d.hp !== null) {
        this.hpNEl.textContent = String(Math.round(d.hp));
        this.hpFillEl.style.width = `${Math.max(0, Math.min(100, d.hp))}%`;
        this.hpEl.classList.toggle('low', d.hp < 25);
        this.hpEl.classList.toggle('mid', d.hp >= 25 && d.hp <= 60);
      }
    }

    this.drawHorizon(d.rollRad, d.pitchRad);

    // countdown / message overlays
    const cdText = d.countdown !== null ? (d.countdown > 0 ? String(d.countdown) : 'GO!') : '';
    if (p.countdown !== cdText) {
      p.countdown = cdText;
      this.countEl.textContent = cdText;
      this.countEl.style.display = cdText ? 'block' : 'none';
      this.countEl.classList.toggle('go', cdText === 'GO!');
    }
    if (p.message !== d.message) {
      p.message = d.message;
      if (d.message) {
        this.msgEl.textContent = d.message;
        this.msgEl.style.display = 'block';
      } else {
        this.msgEl.style.display = 'none';
      }
    }
  }

  /** Flash the red damage vignette (imperative — restarting the CSS animation
   *  avoids threading a decay timestamp through HudData). When the shooter's
   *  bearing relative to the camera is known, a chevron at the matching screen
   *  edge points it out (0 = ahead, +rad = left of the camera). */
  pulseDamage(bearingRad?: number): void {
    this.dmgEl.classList.remove('on');
    void this.dmgEl.offsetWidth; // reflow restarts the animation
    this.dmgEl.classList.add('on');
    if (bearingRad !== undefined) {
      // camera-relative bearing → CSS rotation (positive yaw = left = CCW)
      this.hitDirEl.style.transform = `rotate(${(-bearingRad * 180) / Math.PI}deg)`;
      this.hitDirEl.classList.remove('on');
      void this.hitDirEl.offsetWidth;
      this.hitDirEl.classList.add('on');
    }
  }

  /** "+1" pop on the KILLS chip (retriggered per kill). */
  pulseKill(): void {
    this.killsNEl.classList.remove('pop');
    void this.killsNEl.offsetWidth;
    this.killsNEl.classList.add('pop');
  }

  /** Artificial horizon: translucent sky/ground rotated by −roll, pitch ladder
   *  every 10° (nose up → horizon slides down). Clipped to a circle. */
  private drawHorizon(rollRad: number, pitchRad: number): void {
    const ctx = this.horizonCtx;
    const w = this.horizonCanvas.width;
    const h = this.horizonCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = 96;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.rotate(-rollRad);
    ctx.translate(-cx, -cy);

    const pxPerDeg = 4.5;
    const pitchDeg = (pitchRad * 180) / Math.PI;
    const horizonY = cy + pitchDeg * pxPerDeg;

    ctx.fillStyle = 'rgba(80, 130, 190, 0.14)';
    ctx.fillRect(-w, -h, w * 3, horizonY + h);
    ctx.fillStyle = 'rgba(110, 88, 55, 0.14)';
    ctx.fillRect(-w, horizonY, w * 3, h * 3);

    ctx.strokeStyle = 'rgba(61, 220, 132, 0.9)';
    ctx.fillStyle = 'rgba(61, 220, 132, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';

    ctx.beginPath();
    ctx.moveTo(cx - 78, horizonY);
    ctx.lineTo(cx + 78, horizonY);
    ctx.stroke();

    for (let pDeg = -60; pDeg <= 60; pDeg += 10) {
      if (pDeg === 0) continue;
      const y = cy - (pDeg - pitchDeg) * pxPerDeg;
      const len = pDeg % 20 === 0 ? 34 : 20;
      ctx.beginPath();
      ctx.moveTo(cx - len / 2, y);
      ctx.lineTo(cx + len / 2, y);
      ctx.stroke();
      if (pDeg % 20 === 0) ctx.fillText(`${pDeg > 0 ? '+' : ''}${pDeg}°`, cx - 44, y + 3);
    }
    ctx.restore();

    // static crosshair on top (not rotated)
    ctx.strokeStyle = 'rgba(233, 238, 244, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.moveTo(cx - 12, cy);
    ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy);
    ctx.lineTo(cx + 12, cy);
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx, cy - 5);
    ctx.moveTo(cx, cy + 5);
    ctx.lineTo(cx, cy + 12);
    ctx.stroke();
  }

  destroy(): void {
    this.container.remove();
    this.styleEl.remove();
  }
}
