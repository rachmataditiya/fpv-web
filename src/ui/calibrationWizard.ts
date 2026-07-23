/** Controller panel + calibration wizard — ported from the proven gamepad.js
 *  (TW streamer) and adapted: functions are roll/pitch/yaw/throttle, actions are
 *  arm/respawn/camera/pause, and the axis convention is up/right = POSITIVE
 *  (gamepad.js assumed the gamepad up=negative convention — stick-box Y and the
 *  auto-invert prompt flip accordingly).
 *
 *  Structure kept from the original: device picker + live sticks/bars/buttons,
 *  per-function mapping rows with Learn (largest-excursion auto-detect +
 *  auto-invert), response-curve editor (deadzone/expo/rate + live dot), button
 *  Learn with EDGE-DETECT (baseline snapshot — required for the DJI rest-high
 *  bit), 2-step sweep/center hardware calibration, export/import, reset. */
import { deadzone, expo, norm, readFunction, DEFAULT_CAL } from '../input/calibration';
import { exportProfiles, importProfiles, profileFor, resetProfile, saveProfile } from '../input/profiles';
import type { HidSource } from '../input/hidSource';
import type { InputManager } from '../input/inputManager';
import type { Action, NormalizedInput, Profile } from '../input/types';

const AXES = [
  ['roll', 'Roll'],
  ['pitch', 'Pitch'],
  ['yaw', 'Yaw'],
  ['throttle', 'Throttle'],
] as const;
type FnKey = (typeof AXES)[number][0];

const BTNS: [Action, string][] = [
  ['arm', 'Arm / disarm'],
  ['respawn', 'Respawn'],
  ['camera', 'Camera view'],
  ['pause', 'Pause'],
  ['shoot', 'Shoot'],
];

export interface PanelDeps {
  input: InputManager;
  hid: HidSource | null;
  /** Called whenever the profile changed so the InputManager reloads it. */
  onProfileChanged: () => void;
  onClose?: () => void;
}

interface LearnState {
  tgt: `ax:${FnKey}` | `bt:${Action}`;
  base: number[] | null;
  btnBase: boolean[] | null;
}

interface CalState {
  step: 1 | 2;
  cap: Record<number, { lo: number; hi: number }>;
}

const CSS = `
#cpback{position:fixed;inset:0;z-index:60;background:rgba(5,7,12,.72);backdrop-filter:blur(8px)}
#cpmodal{position:fixed;inset:2.5vh 2.5vw;z-index:61;background:var(--panel);border:1px solid var(--line2);
  border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.55);backdrop-filter:blur(6px);display:flex;flex-direction:column;overflow:hidden}
#cpmodal h3{margin:0;font:800 14px system-ui;white-space:nowrap}
#cpmodal .hd{display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
#cpmodal .hd .sp{flex:1}
#cpmodal .body{flex:1;overflow:auto;padding:14px 16px;min-height:0}
#cpmodal .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
@media(max-width:860px){#cpmodal .cols{grid-template-columns:1fr}}
#cpmodal .card{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:11px 13px;margin:0 0 12px}
#cpmodal .card h4{margin:0 0 8px;font:700 10px system-ui;letter-spacing:.16em;text-transform:uppercase;color:var(--mut)}
#cpmodal select,#cpmodal input[type=number]{background:#0c1017;color:var(--fg);border:1px solid var(--line2);
  border-radius:7px;padding:6px 8px;font:600 12px var(--mono);font-variant-numeric:tabular-nums}
#cpmodal .row{display:flex;align-items:center;gap:9px;margin:6px 0;flex-wrap:wrap}
#cpmodal .row .nm{min-width:96px;font-size:12px;font-family:var(--mono);font-variant-numeric:tabular-nums}
#cpmodal .gbtn{background:#141a26;color:var(--fg);border:1px solid var(--line2);border-radius:7px;
  padding:5px 10px;font:600 11px system-ui;cursor:pointer;transition:120ms ease}
#cpmodal .gbtn:hover{border-color:var(--accent)}
#cpmodal .gbtn:focus-visible{outline:2px solid var(--accent)}
#cpmodal .gbtn.primary{background:var(--accent);border-color:var(--accent);color:#1a1204;font-weight:800}
#cpmodal .gbtn.primary:hover{filter:brightness(1.1)}
#cpmodal .bar{height:8px;border-radius:4px;background:#0c1017;position:relative;flex:1;min-width:80px;overflow:hidden}
#cpmodal .bar i{position:absolute;top:0;bottom:0;left:50%;width:2px;background:var(--accent)}
#cpmodal .dot{width:13px;height:13px;border-radius:50%;background:#1c2130;border:1px solid var(--line2)}
#cpmodal .dot.on{background:var(--green);border-color:var(--green);box-shadow:0 0 6px var(--green)}
#cpmodal label.f{display:flex;justify-content:space-between;font-size:11px;color:var(--mut);margin:5px 0 1px}
#cpmodal input[type=range]{width:100%;accent-color:var(--accent);margin:0}
#cpmodal .x{cursor:pointer;color:var(--mut);font-weight:700;padding:0 4px}
#cpmodal .x:hover{color:var(--warn)}
#cpmodal .close{cursor:pointer;color:var(--mut);font-size:18px;line-height:1}
#cpmodal .mono{font:600 12px var(--mono);font-variant-numeric:tabular-nums}
#cpmodal .curve{display:block;width:100%;height:40px;margin-top:4px;background:#0a0e15;border:1px solid var(--line);border-radius:8px}
#cpmodal .axdet{margin:0 0 8px;border-bottom:1px solid var(--line);padding-bottom:8px}
#cpmodal .axdet>summary{cursor:pointer;font:600 10px system-ui;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);list-style:none;padding:2px 0}
#cpmodal .axdet>summary::-webkit-details-marker{display:none}
#cpmodal .axdet>summary::before{content:'▸ '}#cpmodal .axdet[open]>summary::before{content:'▾ '}
.stickwrap{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.stickbox{position:relative;width:150px;height:150px;background:#0a0e15;border:1px solid var(--line2);border-radius:10px;overflow:hidden}
.stickbox .lbl{position:absolute;top:5px;left:0;right:0;text-align:center;font:700 10px system-ui;letter-spacing:.16em;color:var(--mut);text-transform:uppercase}
.stickbox .gx,.stickbox .gy{position:absolute;background:var(--line2)}
.stickbox .gx{left:0;right:0;top:50%;height:1px}.stickbox .gy{top:0;bottom:0;left:50%;width:1px}
.stickbox .cross{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;border:2px solid var(--green);border-radius:50%;box-shadow:0 0 8px var(--green)}
.stickbox .ext{position:absolute;border:1px dashed var(--accent);background:rgba(77,184,255,.08);pointer-events:none;display:none}
#cpcalwiz{position:fixed;z-index:70;top:50%;left:50%;transform:translate(-50%,-50%);width:min(560px,94vw);
  background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:20px 22px;box-shadow:0 24px 90px rgba(0,0,0,.7);backdrop-filter:blur(6px);text-align:center}
#cpcalwiz h3{margin:0 0 4px;font:800 16px system-ui}
#cpcalwiz .step{color:var(--amber);font-size:13px;margin-bottom:16px;min-height:34px}
#cpcalwiz .stickbox{width:200px;height:200px}#cpcalwiz .ext{display:block}
#cpcalwiz .gbtn{background:#141a26;color:var(--fg);border:1px solid var(--line2);border-radius:8px;padding:8px 16px;font:700 12px system-ui;cursor:pointer;margin:14px 4px 0;transition:120ms ease}
#cpcalwiz .gbtn:hover{border-color:var(--accent)}
#cpcalwiz .gbtn:focus-visible{outline:2px solid var(--accent)}
#cpcalwiz .gbtn.primary{background:var(--amber);border-color:var(--amber);color:#1a1204;font-weight:800}
#cpcalwiz .gbtn.primary:hover{filter:brightness(1.1)}
#cplearn{position:fixed;z-index:71;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--panel);border:2px solid var(--accent);
  border-radius:12px;padding:22px 30px;box-shadow:0 20px 70px rgba(0,0,0,.7);backdrop-filter:blur(6px);text-align:center;font:700 15px system-ui}
#cplearn small{display:block;margin-top:6px;font:600 12px system-ui;color:var(--mut)}

`;

export class ControllerPanel {
  private deps: PanelDeps;
  private root: HTMLElement;
  private back: HTMLDivElement | null = null;
  private modal: HTMLDivElement | null = null;
  private wiz: HTMLDivElement | null = null;
  private learnEl: HTMLDivElement | null = null;
  private learn: LearnState | null = null;
  private cal: CalState | null = null;
  private raf = 0;
  private curId: string | null = null;
  private prof: Profile | null = null;
  isOpen = false;

  constructor(root: HTMLElement, deps: PanelDeps) {
    this.deps = deps;
    this.root = root;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.isOpen) return;
      e.stopImmediatePropagation(); // don't also toggle the sim pause
      if (this.cal) this.stopCal();
      else if (this.learn) this.endLearn(false);
      else this.close();
    }, { capture: true });
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.back = document.createElement('div');
    this.back.id = 'cpback';
    this.back.onclick = () => this.close();
    this.modal = document.createElement('div');
    this.modal.id = 'cpmodal';
    this.root.append(this.back, this.modal);
    this.render();
    this.raf = requestAnimationFrame(this.live);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    cancelAnimationFrame(this.raf);
    this.back?.remove();
    this.modal?.remove();
    this.wiz?.remove();
    this.learnEl?.remove();
    this.back = this.modal = this.wiz = this.learnEl = null;
    this.learn = null;
    this.cal = null;
    this.deps.onProfileChanged();
    this.deps.onClose?.();
  }

  // ---------- helpers ----------
  private pad(): NormalizedInput | null {
    return this.deps.input.activePad();
  }

  private bind(id: string): void {
    this.curId = id;
    this.prof = profileFor(id);
  }

  private put(): void {
    if (this.curId && this.prof) saveProfile(this.curId, this.prof);
  }

  /** Stick-box axis layout. DJI RC + keyboard use [roll,pitch,thr,yaw] order →
   *  right stick = axes 0/1, LEFT = 3(H)/2(V). Generic pads are Mode-2. */
  private layout(id: string): { L: [number, number]; R: [number, number]; lL: string; lR: string } {
    return id.startsWith('DJI RC') || id === 'keyboard'
      ? { L: [3, 2], R: [0, 1], lL: 'Left · yaw/thr', lR: 'Right · roll/pitch' }
      : { L: [0, 1], R: [2, 3], lL: 'Left · ax0/1', lR: 'Right · ax2/3' };
  }

  // ---------- static render ----------
  private render(): void {
    if (!this.modal) return;
    const pad = this.pad();
    if (pad && this.curId !== pad.id) this.bind(pad.id);
    const prof = this.prof;
    const nA = pad ? pad.axes.length : 0;
    const nB = pad ? pad.buttons.length : 0;
    const opts = (n: number, sel: number | null) => {
      let s = '<option value="">—</option>';
      for (let i = 0; i < n; i++) s += `<option value="${i}"${i === sel ? ' selected' : ''}>${i}</option>`;
      return s;
    };

    let hd = `<h3>🎮 Controller</h3><span class="mono" style="color:var(--mut)">${pad ? pad.id.slice(0, 44) : 'no device — plug in / press a key'}</span>`;
    if (this.deps.hid) hd += `<button class="gbtn" id="cphid">🎚 Connect DJI RC (USB)</button>`;
    hd += `<span class="sp"></span>
      <button class="gbtn" id="cpexp" title="Export profiles">⭳ Export</button>
      <button class="gbtn" id="cpimp" title="Import profiles">⭱ Import</button>
      <button class="gbtn" id="cprst">Reset device</button>
      <span class="close" id="cpx">✕</span>`;

    let colL = '';
    let colR = '';
    if (pad && prof) {
      colL = `<div class="card"><h4>Sticks (live)</h4>
        <div class="stickwrap">
          <div class="stickbox" id="cpsbL"><span class="lbl" id="cpslL">Left</span><span class="gx"></span><span class="gy"></span><i class="cross"></i></div>
          <div class="stickbox" id="cpsbR"><span class="lbl" id="cpslR">Right</span><span class="gx"></span><span class="gy"></span><i class="cross"></i></div>
        </div>
        <div class="row" id="cpbtns" style="margin-top:10px"></div>
        <div id="cpaxall" style="margin-top:10px"></div></div>
        <div class="card"><h4>Buttons → actions</h4>`;
      for (const [k, lbl] of BTNS) {
        colL += `<div class="row"><span class="nm">${lbl}</span>
          <button class="gbtn" data-learn="bt:${k}">Learn</button>
          <select data-bt="${k}">${opts(nB, prof.buttons[k])}</select></div>`;
      }
      colL += `</div>`;

      colR = `<div class="card"><div class="row" style="justify-content:space-between;margin:0 0 6px">
        <h4 style="margin:0">Axes → flight</h4><button class="gbtn" id="cpcal">🎯 Stick calibration</button></div>`;
      for (const [k, lbl] of AXES) {
        const a = prof.axes[k];
        const isThr = k === 'throttle';
        colR += `<div class="row"><span class="nm">${lbl}</span>
          <button class="gbtn" data-learn="ax:${k}">Learn</button>
          <select data-ax="${k}">${opts(nA, a.axis)}</select>
          <span class="x" data-clr="${k}" title="clear">✕</span>
          <div class="bar"><i id="cpb-${k}" style="left:50%"></i></div>
          <label style="font-size:11px;white-space:nowrap"><input type="checkbox" data-inv="${k}" ${a.invert ? 'checked' : ''}> Inv</label>
          <span class="mono" id="cpv-${k}" style="width:40px;text-align:right;color:var(--mut)">—</span></div>
          <details class="axdet" ${k === 'roll' ? 'open' : ''}><summary>tuning · curve</summary>
          <label class="f">Deadzone <span>${a.deadzone.toFixed(2)}</span></label>
          <input type="range" min="0" max="0.5" step="0.01" value="${a.deadzone}" data-dz="${k}">
          <label class="f">Expo <span>${a.expo.toFixed(2)}</span></label>
          <input type="range" min="0" max="1" step="0.05" value="${a.expo}" data-expo="${k}">
          <svg class="curve" data-curve="${k}" viewBox="0 0 100 60" preserveAspectRatio="none">
            <line x1="0" y1="30" x2="100" y2="30" stroke="#2e3748" stroke-width=".6"/>
            <line x1="50" y1="0" x2="50" y2="60" stroke="#2e3748" stroke-width=".6"/>
            <polyline class="cv" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
            <circle class="ldot" r="2.4" fill="#ff4bd8" cx="50" cy="30" style="display:none"/>
          </svg>` +
          (isThr
            ? ''
            : `<div class="row"><span class="nm">Rate °/s</span><input type="number" style="width:76px" min="60" max="1200" value="${a.rate}" data-rate="${k}"></div>`) +
          `</details>`;
      }
      colR += `</div>`;
    } else {
      colL = `<div class="card"><div style="color:var(--mut);font-size:12px">Connect your DJI RC over USB (button above), plug in a gamepad and press any button, or just use the keyboard (arrows + WASD).</div></div>`;
    }

    this.modal.innerHTML = `<div class="hd">${hd}</div><div class="body"><div class="cols"><div>${colL}</div><div>${colR}</div></div></div>`;
    this.wire(nA, nB);
    for (const [k] of AXES) this.drawCurve(k);
  }

  private wire(_nA: number, _nB: number): void {
    const m = this.modal!;
    const $1 = (q: string) => m.querySelector(q) as HTMLElement | null;
    const $$ = (q: string) => m.querySelectorAll(q);
    ($1('#cpx') as HTMLElement).onclick = () => this.close();
    const hid = $1('#cphid');
    if (hid) hid.onclick = () => void this.deps.hid?.connect().then(() => this.render());
    const cal = $1('#cpcal');
    if (cal) cal.onclick = () => this.startCal();
    const rst = $1('#cprst');
    if (rst)
      rst.onclick = () => {
        if (this.curId) this.prof = resetProfile(this.curId);
        this.render();
      };
    const exp = $1('#cpexp');
    if (exp)
      exp.onclick = () => {
        const blob = new Blob([exportProfiles()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'fpv-input-profiles.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      };
    const imp = $1('#cpimp');
    if (imp)
      imp.onclick = () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'application/json,.json';
        inp.onchange = () => {
          const f = inp.files?.[0];
          if (!f) return;
          void f.text().then((t) => {
            try {
              importProfiles(t);
              if (this.curId) this.prof = profileFor(this.curId);
              this.render();
            } catch {
              alert('Not a valid profile file');
            }
          });
        };
        inp.click();
      };

    if (!this.prof) return;
    const prof = this.prof;
    $$('[data-learn]').forEach((b) => ((b as HTMLElement).onclick = () => this.startLearn((b as HTMLElement).dataset.learn as LearnState['tgt'])));
    $$('[data-ax]').forEach((s) => ((s as HTMLSelectElement).onchange = () => {
      const el = s as HTMLSelectElement;
      prof.axes[el.dataset.ax as FnKey].axis = el.value === '' ? null : +el.value;
      this.put();
    }));
    $$('[data-bt]').forEach((s) => ((s as HTMLSelectElement).onchange = () => {
      const el = s as HTMLSelectElement;
      prof.buttons[el.dataset.bt as Action] = el.value === '' ? null : +el.value;
      this.put();
    }));
    $$('[data-clr]').forEach((x) => ((x as HTMLElement).onclick = () => {
      prof.axes[(x as HTMLElement).dataset.clr as FnKey].axis = null;
      this.put();
      this.render();
    }));
    $$('[data-inv]').forEach((c) => ((c as HTMLInputElement).onchange = () => {
      const el = c as HTMLInputElement;
      prof.axes[el.dataset.inv as FnKey].invert = el.checked;
      this.put();
    }));
    const slider = (attr: 'dz' | 'expo' | 'rate', set: (k: FnKey, v: number) => void, fmt = true) =>
      $$(`[data-${attr}]`).forEach((el) => ((el as HTMLInputElement).oninput = () => {
        const inp = el as HTMLInputElement;
        const k = inp.dataset[attr] as FnKey;
        set(k, +inp.value);
        this.put();
        if (fmt) {
          const lbl = inp.previousElementSibling?.querySelector('span');
          if (lbl) lbl.textContent = (+inp.value).toFixed(2);
        }
        this.drawCurve(k);
      }));
    slider('dz', (k, v) => (prof.axes[k].deadzone = v));
    slider('expo', (k, v) => (prof.axes[k].expo = v));
    slider('rate', (k, v) => (prof.axes[k].rate = v), false);
  }

  /** Response curve: input → output through deadzone+expo. The magenta dot (live
   *  stick position through the curve) is updated by the live loop. */
  private drawCurve(k: FnKey): void {
    const svg = this.modal?.querySelector(`[data-curve="${k}"]`);
    if (!svg || !this.prof) return;
    const a = this.prof.axes[k];
    const pts: string[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = -1 + i / 20;
      const y = expo(deadzone(x, a.deadzone), a.expo);
      pts.push(`${(x * 50 + 50).toFixed(1)},${(30 - y * 28).toFixed(1)}`);
    }
    svg.querySelector('.cv')!.setAttribute('points', pts.join(' '));
  }

  // ---------- learn mode ----------
  private startLearn(tgt: LearnState['tgt']): void {
    const pad = this.pad();
    this.learn = {
      tgt,
      base: pad ? [...pad.axes] : null,
      // Snapshot held buttons so a rest-high bit (DJI RC) is never mislatched —
      // only an unpressed→pressed transition counts.
      btnBase: pad ? [...pad.buttons] : null,
    };
    this.learnEl = document.createElement('div');
    this.learnEl.id = 'cplearn';
    const isAx = tgt.startsWith('ax:');
    const name = isAx
      ? AXES.find((a) => a[0] === tgt.slice(3))![1]
      : BTNS.find((b) => b[0] === tgt.slice(3))![1];
    this.learnEl.innerHTML = isAx
      ? `Move <b>${name}</b> toward its <b>POSITIVE</b> direction (up / right), fully<small>Esc to cancel</small>`
      : `Press the button for <b>${name}</b><small>Esc to cancel</small>`;
    this.root.appendChild(this.learnEl);
  }

  private endLearn(applied: boolean): void {
    this.learn = null;
    this.learnEl?.remove();
    this.learnEl = null;
    if (applied) this.put();
    this.render();
  }

  // ---------- hardware calibration wizard ----------
  private startCal(): void {
    const pad = this.pad();
    if (!pad || !this.prof) return;
    const cap: CalState['cap'] = {};
    for (let i = 0; i < pad.axes.length; i++) cap[i] = { lo: pad.axes[i], hi: pad.axes[i] };
    this.cal = { step: 1, cap };
    this.wiz = document.createElement('div');
    this.wiz.id = 'cpcalwiz';
    this.root.appendChild(this.wiz);
    this.renderCal();
  }

  private stopCal(): void {
    this.cal = null;
    this.wiz?.remove();
    this.wiz = null;
  }

  private renderCal(): void {
    if (!this.wiz || !this.cal) return;
    this.wiz.innerHTML = `<h3>🎯 Stick calibration</h3>
      <div class="step">${
        this.cal.step === 1
          ? 'Sweep <b>both sticks fully to every corner</b> (full circles, hit all edges), and spin the dial.'
          : 'Release the sticks to <b>center</b>. If your throttle stick does not spring back, hold it at its <b>physical middle</b>. Then press Done.'
      }</div>
      <div class="stickwrap">
        <div class="stickbox" id="cpwbL"><span class="lbl" id="cpwlL">Left</span><span class="gx"></span><span class="gy"></span><div class="ext"></div><i class="cross"></i></div>
        <div class="stickbox" id="cpwbR"><span class="lbl" id="cpwlR">Right</span><span class="gx"></span><span class="gy"></span><div class="ext"></div><i class="cross"></i></div>
      </div>
      <div><button class="gbtn primary" id="cpwnext">${this.cal.step === 1 ? 'Next →' : '✓ Done'}</button>
        <button class="gbtn" id="cpwcancel">Cancel</button></div>`;
    (this.wiz.querySelector('#cpwnext') as HTMLElement).onclick = () => {
      if (!this.cal) return;
      if (this.cal.step === 1) {
        this.cal.step = 2;
        this.renderCal();
      } else {
        const pad = this.pad();
        if (pad && this.prof) {
          this.prof.axcal = {};
          for (const i of Object.keys(this.cal.cap)) {
            const n = +i;
            this.prof.axcal[n] = { lo: this.cal.cap[n].lo, hi: this.cal.cap[n].hi, center: pad.axes[n] ?? 0 };
          }
          this.put();
        }
        this.stopCal();
        this.render();
      }
    };
    (this.wiz.querySelector('#cpwcancel') as HTMLElement).onclick = () => this.stopCal();
  }

  // ---------- live loop (runs only while open) ----------
  /** Screen mapping for our up=positive convention: top of box = +1. */
  private static pctX(v: number): number {
    return (v / 2 + 0.5) * 100;
  }
  private static pctY(v: number): number {
    return (0.5 - v / 2) * 100;
  }

  private drawStick(box: HTMLElement | null, pad: NormalizedInput, xi: number, yi: number): void {
    if (!box) return;
    const cr = box.querySelector('.cross') as HTMLElement;
    cr.style.left = `${ControllerPanel.pctX(pad.axes[xi] ?? 0)}%`;
    cr.style.top = `${ControllerPanel.pctY(pad.axes[yi] ?? 0)}%`;
  }

  private live = (): void => {
    if (!this.isOpen) return;
    this.raf = requestAnimationFrame(this.live);
    const pad = this.pad();
    if (!pad) return;
    if (this.curId !== pad.id) {
      this.bind(pad.id);
      this.render();
      return;
    }
    const prof = this.prof!;
    const lay = this.layout(pad.id);

    // learn: axis = largest excursion from baseline (>0.5) with AUTO-INVERT on a
    // negative move (the prompt asked for POSITIVE); button = first fresh edge.
    if (this.learn) {
      const { tgt, base, btnBase } = this.learn;
      if (tgt.startsWith('ax:')) {
        let bi = -1;
        let bd = 0.5;
        let sign = 0;
        for (let i = 0; i < pad.axes.length; i++) {
          const d = pad.axes[i] - (base?.[i] ?? 0);
          if (Math.abs(d) > bd) {
            bd = Math.abs(d);
            bi = i;
            sign = Math.sign(d);
          }
        }
        if (bi >= 0) {
          const ax = prof.axes[tgt.slice(3) as FnKey];
          ax.axis = bi;
          ax.invert = sign < 0;
          this.endLearn(true);
          return;
        }
      } else {
        for (let i = 0; i < pad.buttons.length; i++) {
          if (pad.buttons[i] && !btnBase?.[i]) {
            prof.buttons[tgt.slice(3) as Action] = i;
            this.endLearn(true);
            return;
          }
        }
      }
    }

    // calibration wizard live capture + big boxes
    if (this.cal && this.wiz) {
      if (this.cal.step === 1)
        for (let i = 0; i < pad.axes.length; i++) {
          const c = this.cal.cap[i];
          if (c) {
            c.lo = Math.min(c.lo, pad.axes[i]);
            c.hi = Math.max(c.hi, pad.axes[i]);
          }
        }
      const bL = this.wiz.querySelector('#cpwbL') as HTMLElement;
      const bR = this.wiz.querySelector('#cpwbR') as HTMLElement;
      this.drawStick(bL, pad, lay.L[0], lay.L[1]);
      this.drawStick(bR, pad, lay.R[0], lay.R[1]);
      (this.wiz.querySelector('#cpwlL') as HTMLElement).textContent = lay.lL;
      (this.wiz.querySelector('#cpwlR') as HTMLElement).textContent = lay.lR;
      const ext = (box: HTMLElement, xi: number, yi: number) => {
        const e = box.querySelector('.ext') as HTMLElement;
        const cx = this.cal!.cap[xi];
        const cy = this.cal!.cap[yi];
        if (!cx || !cy) return;
        e.style.left = `${ControllerPanel.pctX(cx.lo)}%`;
        e.style.top = `${ControllerPanel.pctY(cy.hi)}%`; // hi is TOP on screen
        e.style.width = `${ControllerPanel.pctX(cx.hi) - ControllerPanel.pctX(cx.lo)}%`;
        e.style.height = `${ControllerPanel.pctY(cy.lo) - ControllerPanel.pctY(cy.hi)}%`;
      };
      ext(bL, lay.L[0], lay.L[1]);
      ext(bR, lay.R[0], lay.R[1]);
      return; // modal underneath doesn't need live updates while calibrating
    }

    // small live boxes + labels
    if (this.modal) {
      this.drawStick(this.modal.querySelector('#cpsbL'), pad, lay.L[0], lay.L[1]);
      this.drawStick(this.modal.querySelector('#cpsbR'), pad, lay.R[0], lay.R[1]);
      const lL = this.modal.querySelector('#cpslL') as HTMLElement | null;
      const lR = this.modal.querySelector('#cpslR') as HTMLElement | null;
      if (lL && lL.textContent !== lay.lL) lL.textContent = lay.lL;
      if (lR && lR.textContent !== lay.lR) lR.textContent = lay.lR;

      // button dots
      const bt = this.modal.querySelector('#cpbtns') as HTMLElement | null;
      if (bt) {
        if (bt.children.length !== pad.buttons.length) {
          bt.innerHTML = pad.buttons.map((_, i) => `<span class="dot" title="btn ${i}"></span>`).join('');
        }
        for (let i = 0; i < pad.buttons.length; i++)
          (bt.children[i] as HTMLElement).classList.toggle('on', pad.buttons[i]);
      }

      // per-axis raw bars
      const axall = this.modal.querySelector('#cpaxall') as HTMLElement | null;
      if (axall) {
        if (axall.children.length !== pad.axes.length) {
          axall.innerHTML = pad.axes
            .map(
              (_, i) => `<div class="row" style="margin:3px 0"><span class="nm" style="min-width:52px">axis ${i}</span>
              <div class="bar"><i id="cpraw-${i}" style="left:50%"></i></div>
              <span class="mono" id="cprawv-${i}" style="width:44px;text-align:right;color:var(--mut)">0.00</span></div>`,
            )
            .join('');
        }
        for (let i = 0; i < pad.axes.length; i++) {
          const bar = this.modal.querySelector(`#cpraw-${i}`) as HTMLElement | null;
          const lab = this.modal.querySelector(`#cprawv-${i}`) as HTMLElement | null;
          if (bar) bar.style.left = `${ControllerPanel.pctX(pad.axes[i])}%`;
          if (lab) lab.textContent = pad.axes[i].toFixed(2);
        }
      }

      // mapped-function bars + live curve dot
      for (const [k] of AXES) {
        const a = prof.axes[k];
        const bar = this.modal.querySelector(`#cpb-${k}`) as HTMLElement | null;
        const val = this.modal.querySelector(`#cpv-${k}`) as HTMLElement | null;
        const dot = this.modal.querySelector(`[data-curve="${k}"] .ldot`) as SVGCircleElement | null;
        if (a.axis != null) {
          const v = readFunction(pad, a, prof.axcal);
          if (bar) bar.style.left = `${ControllerPanel.pctX(v)}%`;
          if (val) val.textContent = v.toFixed(2);
          if (dot) {
            const raw = norm(pad.axes[a.axis], prof.axcal[a.axis] ?? DEFAULT_CAL) * (a.invert ? -1 : 1);
            dot.style.display = '';
            dot.setAttribute('cx', String(raw * 50 + 50));
            dot.setAttribute('cy', String(30 - v * 28));
          }
        } else {
          if (bar) bar.style.left = '50%';
          if (val) val.textContent = '—';
          if (dot) dot.style.display = 'none';
        }
      }
    }
  };
}
