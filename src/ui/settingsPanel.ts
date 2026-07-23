import type { BotDifficulty, Quality, Settings } from '../state';
import type { Profile } from '../input/types';

export interface SettingsDeps {
  settings: Settings;
  apply: {
    quality(q: Quality): void;
    uptilt(deg: number): void;
    fov(deg: number): void;
    chaseStiffness(w: number): void;
    freeFly(on: boolean): void;
    /** War-mode rows — effect on next map load; the callback just flashes. */
    bots(on: boolean): void;
    botDifficulty(d: BotDifficulty): void;
    /** Master SFX volume, 0–1 — applied live. */
    volume(v: number): void;
    /** Killer-POV replay on death — read at death time, no live apply needed. */
    killcam(on: boolean): void;
  };
  save(): void;
  /** Live access to the ACTIVE input device's profile (rates/expo/throttle). */
  rates?: {
    get(): { deviceId: string; profile: Profile } | null;
    persist(): void;
  };
  /** BSP-map track tools (only provided on BSP maps). */
  bspTrack?: {
    toggleEditor(): void;
    canExport(): boolean;
    exportJson(): void;
  };
  openControllerPanel(): void;
  restartRace(): void;
}

export class SettingsPanel {
  private readonly root: HTMLElement;
  private readonly deps: SettingsDeps;
  private overlayEl: HTMLDivElement | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private _open = false;

  private static styleInjected = false;

  constructor(root: HTMLElement, deps: SettingsDeps) {
    this.root = root;
    this.deps = deps;
    this._injectStyles();
    this._createDOM();
  }

  open(): void {
    if (this._open) return;
    this._open = true;
    if (!this.overlayEl) return;
    this.overlayEl.style.display = 'flex';
    this.syncControls();
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);
  }

  close(): void {
    if (!this._open) return;
    this._open = false;
    if (this.overlayEl) this.overlayEl.style.display = 'none';
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  get isOpen(): boolean {
    return this._open;
  }

  private syncControls(): void {
    if (!this.overlayEl) return;
    const s = this.deps.settings;
    // Quality buttons
    const buttons = this.overlayEl.querySelectorAll<HTMLButtonElement>('.quality-btn');
    buttons.forEach(btn => {
      const q = btn.dataset.quality;
      if (q === s.quality) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    // Uptilt
    const uptiltInput = this.overlayEl.querySelector<HTMLInputElement>('.uptilt-slider');
    const uptiltLabel = this.overlayEl.querySelector<HTMLSpanElement>('.uptilt-value');
    if (uptiltInput) uptiltInput.value = String(s.uptiltDeg);
    if (uptiltLabel) uptiltLabel.textContent = `${s.uptiltDeg}°`;
    // FOV
    const fovInput = this.overlayEl.querySelector<HTMLInputElement>('.fov-slider');
    const fovLabel = this.overlayEl.querySelector<HTMLSpanElement>('.fov-value');
    if (fovInput) fovInput.value = String(s.fovDeg);
    if (fovLabel) fovLabel.textContent = `${s.fovDeg}°`;
    // Chase stiffness
    const chaseInput = this.overlayEl.querySelector<HTMLInputElement>('.chase-slider');
    const chaseLabel = this.overlayEl.querySelector<HTMLSpanElement>('.chase-value');
    if (chaseInput) chaseInput.value = String(s.chaseStiffness);
    if (chaseLabel) chaseLabel.textContent = s.chaseStiffness.toFixed(1);
    // Free-fly
    const freeFlyCheck = this.overlayEl.querySelector<HTMLInputElement>('.freefly-check');
    if (freeFlyCheck) freeFlyCheck.checked = s.freeFly;
    // War mode
    const botsCheck = this.overlayEl.querySelector<HTMLInputElement>('.bots-check');
    if (botsCheck) botsCheck.checked = s.bots;
    this.overlayEl.querySelectorAll<HTMLButtonElement>('.difficulty-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.difficulty === s.botDifficulty);
    });
    const killcamCheck = this.overlayEl.querySelector<HTMLInputElement>('.killcam-check');
    if (killcamCheck) killcamCheck.checked = s.killcam;
    // Audio
    const volInput = this.overlayEl.querySelector<HTMLInputElement>('.volume-slider');
    const volLabel = this.overlayEl.querySelector<HTMLSpanElement>('.volume-value');
    if (volInput) volInput.value = String(Math.round(s.volume * 100));
    if (volLabel) volLabel.textContent = `${Math.round(s.volume * 100)}%`;

    // Rates & throttle (active device profile)
    const active = this.deps.rates?.get() ?? null;
    const devEl = this.overlayEl.querySelector<HTMLSpanElement>('.rates-device');
    if (devEl) devEl.textContent = active ? active.deviceId.slice(0, 34) : 'no device';
    const setSlider = (cls: string, value: number, label: string) => {
      const input = this.overlayEl!.querySelector<HTMLInputElement>(`.${cls}-slider`);
      const lab = this.overlayEl!.querySelector<HTMLSpanElement>(`.${cls}-value`);
      if (input) input.value = String(value);
      if (lab) lab.textContent = label;
    };
    if (active) {
      const a = active.profile.axes;
      setSlider('rr', a.roll.rate ?? 400, `${a.roll.rate ?? 400}°/s`);
      setSlider('pr', a.pitch.rate ?? 400, `${a.pitch.rate ?? 400}°/s`);
      setSlider('yr', a.yaw.rate ?? 400, `${a.yaw.rate ?? 400}°/s`);
      setSlider('rpx', a.roll.expo, a.roll.expo.toFixed(2));
      setSlider('yx', a.yaw.expo, a.yaw.expo.toFixed(2));
      setSlider('tx', a.throttle.expo, a.throttle.expo.toFixed(2));
      const lim = Math.round((a.throttle.limit ?? 1) * 100);
      setSlider('tl', lim, `${lim}%`);
    }
  }

  private _createDOM(): void {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.style.display = 'none';

    // Backdrop click → close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // Panel
    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.addEventListener('click', (e) => e.stopPropagation());

    // Title
    const title = document.createElement('h2');
    title.className = 'settings-title';
    title.textContent = 'Settings';
    panel.appendChild(title);

    // Quality row
    const qualityContainer = document.createElement('div');
    qualityContainer.className = 'quality-buttons';
    (['low', 'med', 'high'] as Quality[]).forEach(q => {
      const btn = document.createElement('button');
      btn.classList.add('quality-btn');
      btn.textContent = q.charAt(0).toUpperCase() + q.slice(1);
      btn.dataset.quality = q;
      btn.addEventListener('click', () => {
        this.deps.settings.quality = q;
        this.deps.apply.quality(q);
        this.deps.save();
        this.syncControls();
      });
      qualityContainer.appendChild(btn);
    });
    panel.appendChild(qualityContainer);

    // Uptilt slider
    const uptiltGroup = this._makeSliderGroup('FPV camera uptilt', '0', '40', '1', '°',
      (value) => {
        this.deps.settings.uptiltDeg = value;
        this.deps.apply.uptilt(value);
      }
    );
    uptiltGroup.querySelector('.slider-input')!.classList.add('uptilt-slider');
    uptiltGroup.querySelector('.live-label')!.classList.add('uptilt-value');
    panel.appendChild(uptiltGroup);

    // FOV slider
    const fovGroup = this._makeSliderGroup('FPV FOV', '90', '140', '1', '°',
      (value) => {
        this.deps.settings.fovDeg = value;
        this.deps.apply.fov(value);
      }
    );
    fovGroup.querySelector('.slider-input')!.classList.add('fov-slider');
    fovGroup.querySelector('.live-label')!.classList.add('fov-value');
    panel.appendChild(fovGroup);

    // Chase stiffness slider
    const chaseGroup = this._makeSliderGroup('Chase smoothness', '8', '20', '0.1', '',
      (value) => {
        this.deps.settings.chaseStiffness = value;
        this.deps.apply.chaseStiffness(value);
      }
    );
    chaseGroup.querySelector('.slider-input')!.classList.add('chase-slider');
    chaseGroup.querySelector('.live-label')!.classList.add('chase-value');
    panel.appendChild(chaseGroup);

    // Free‑fly checkbox
    const checkboxGroup = document.createElement('div');
    checkboxGroup.className = 'checkbox-group';
    const freeFlyInput = document.createElement('input');
    freeFlyInput.type = 'checkbox';
    freeFlyInput.className = 'freefly-check';
    freeFlyInput.addEventListener('change', () => {
      const checked = freeFlyInput.checked;
      this.deps.settings.freeFly = checked;
      this.deps.apply.freeFly(checked);
      this.deps.save();
    });
    const freeFlyLabel = document.createElement('label');
    freeFlyLabel.textContent = 'Free‑fly mode';
    freeFlyLabel.prepend(freeFlyInput);
    checkboxGroup.appendChild(freeFlyLabel);
    panel.appendChild(checkboxGroup);

    // ---- War mode: bots on/off + difficulty (apply on next map load) ----
    const botsGroup = document.createElement('div');
    botsGroup.className = 'checkbox-group';
    const botsInput = document.createElement('input');
    botsInput.type = 'checkbox';
    botsInput.className = 'bots-check';
    botsInput.addEventListener('change', () => {
      this.deps.settings.bots = botsInput.checked;
      this.deps.apply.bots(botsInput.checked);
      this.deps.save();
    });
    const botsLabel = document.createElement('label');
    botsLabel.textContent = 'Enemy bots (next map load)';
    botsLabel.prepend(botsInput);
    botsGroup.appendChild(botsLabel);
    panel.appendChild(botsGroup);

    const diffLabel = document.createElement('label');
    diffLabel.className = 'slider-label';
    diffLabel.textContent = 'Bot difficulty (next map load)';
    panel.appendChild(diffLabel);
    const diffContainer = document.createElement('div');
    diffContainer.className = 'quality-buttons';
    (['easy', 'normal', 'hard'] as BotDifficulty[]).forEach(d => {
      const btn = document.createElement('button');
      btn.classList.add('quality-btn', 'difficulty-btn');
      btn.textContent = d.charAt(0).toUpperCase() + d.slice(1);
      btn.dataset.difficulty = d;
      btn.addEventListener('click', () => {
        this.deps.settings.botDifficulty = d;
        this.deps.apply.botDifficulty(d);
        this.deps.save();
        this.syncControls();
      });
      diffContainer.appendChild(btn);
    });
    panel.appendChild(diffContainer);

    // Killcam checkbox (war mode)
    const killcamGroup = document.createElement('div');
    killcamGroup.className = 'checkbox-group';
    const killcamInput = document.createElement('input');
    killcamInput.type = 'checkbox';
    killcamInput.className = 'killcam-check';
    killcamInput.addEventListener('change', () => {
      this.deps.settings.killcam = killcamInput.checked;
      this.deps.apply.killcam(killcamInput.checked);
      this.deps.save();
    });
    const killcamLabel = document.createElement('label');
    killcamLabel.textContent = 'Killcam on death';
    killcamLabel.prepend(killcamInput);
    killcamGroup.appendChild(killcamLabel);
    panel.appendChild(killcamGroup);

    // Master volume slider (live)
    const volGroup = this._makeSliderGroup('Volume', '0', '100', '1', '%',
      (value) => {
        this.deps.settings.volume = value / 100;
        this.deps.apply.volume(value / 100);
      }
    );
    volGroup.querySelector('.slider-input')!.classList.add('volume-slider');
    volGroup.querySelector('.live-label')!.classList.add('volume-value');
    panel.appendChild(volGroup);

    // ---- Rates & throttle (edits the active device's profile — same data the
    // controller panel edits, so both stay in sync) ----
    const ratesHead = document.createElement('div');
    ratesHead.className = 'settings-title';
    ratesHead.style.cssText = 'margin-top:14px;display:flex;justify-content:space-between;align-items:baseline';
    ratesHead.innerHTML = 'Rates & throttle <span class="rates-device" style="font:600 10px var(--mono);color:var(--mut);letter-spacing:0;text-transform:none"></span>';
    panel.appendChild(ratesHead);

    const prof = () => this.deps.rates?.get()?.profile ?? null;
    const persist = () => this.deps.rates?.persist();
    const rateSlider = (
      cls: string,
      label: string,
      min: string,
      max: string,
      step: string,
      set: (p: Profile, v: number) => void,
      fmt: (v: number) => string,
    ) => {
      const g = this._makeSliderGroup(label, min, max, step, '', (value) => {
        const p = prof();
        if (!p) return;
        set(p, value);
        persist();
        const lab = g.querySelector<HTMLSpanElement>('.live-label');
        if (lab) lab.textContent = fmt(value);
      });
      g.querySelector('.slider-input')!.classList.add(`${cls}-slider`);
      g.querySelector('.live-label')!.classList.add(`${cls}-value`);
      panel.appendChild(g);
    };
    const degs = (v: number) => `${Math.round(v)}°/s`;
    rateSlider('rr', 'Roll rate', '120', '1200', '10', (p, v) => (p.axes.roll.rate = v), degs);
    rateSlider('pr', 'Pitch rate', '120', '1200', '10', (p, v) => (p.axes.pitch.rate = v), degs);
    rateSlider('yr', 'Yaw rate', '60', '900', '10', (p, v) => (p.axes.yaw.rate = v), degs);
    rateSlider('rpx', 'Roll/Pitch expo', '0', '1', '0.05', (p, v) => {
      p.axes.roll.expo = v;
      p.axes.pitch.expo = v;
    }, (v) => v.toFixed(2));
    rateSlider('yx', 'Yaw expo', '0', '1', '0.05', (p, v) => (p.axes.yaw.expo = v), (v) => v.toFixed(2));
    rateSlider('tx', 'Throttle expo', '0', '1', '0.05', (p, v) => (p.axes.throttle.expo = v), (v) => v.toFixed(2));
    rateSlider('tl', 'Throttle limit', '50', '100', '1', (p, v) => (p.axes.throttle.limit = v / 100), (v) => `${Math.round(v)}%`);

    // Action buttons
    const actionContainer = document.createElement('div');
    actionContainer.className = 'action-buttons';

    const controllerBtn = document.createElement('button');
    controllerBtn.className = 'action-btn';
    controllerBtn.textContent = '🎮 Controller & calibration';
    controllerBtn.addEventListener('click', () => {
      this.deps.openControllerPanel();
      this.close();
    });
    actionContainer.appendChild(controllerBtn);

    if (this.deps.bspTrack) {
      const bt = this.deps.bspTrack;
      const editBtn = document.createElement('button');
      editBtn.className = 'action-btn';
      editBtn.textContent = '🏗 Edit race track (T)';
      editBtn.addEventListener('click', () => {
        bt.toggleEditor();
        this.close();
      });
      actionContainer.appendChild(editBtn);
      const exportBtn = document.createElement('button');
      exportBtn.className = 'action-btn';
      exportBtn.textContent = '⭳ Export track.json';
      exportBtn.addEventListener('click', () => {
        if (bt.canExport()) bt.exportJson();
      });
      actionContainer.appendChild(exportBtn);
    }

    const restartBtn = document.createElement('button');
    restartBtn.className = 'action-btn';
    restartBtn.textContent = 'Restart race';
    restartBtn.addEventListener('click', () => {
      this.deps.restartRace();
      this.close();
    });
    actionContainer.appendChild(restartBtn);

    panel.appendChild(actionContainer);
    overlay.appendChild(panel);
    this.root.appendChild(overlay);
    this.overlayEl = overlay;
  }

  private _makeSliderGroup(
    labelText: string,
    min: string,
    max: string,
    step: string,
    suffix: string,
    onChange: (value: number) => void
  ): HTMLElement {
    const group = document.createElement('div');
    group.className = 'slider-group';

    const label = document.createElement('label');
    label.className = 'slider-label';
    label.textContent = labelText;

    const row = document.createElement('div');
    row.className = 'slider-row';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.className = 'slider-input';
    const liveValue = document.createElement('span');
    liveValue.className = 'live-label';

    input.addEventListener('input', () => {
      const value = parseFloat(input.value);
      if (!isNaN(value)) {
        onChange(value);
        liveValue.textContent = `${value}${suffix}`;
        this.deps.save();
      }
    });

    row.appendChild(input);
    row.appendChild(liveValue);
    group.appendChild(label);
    group.appendChild(row);
    return group;
  }

  private _injectStyles(): void {
    if (SettingsPanel.styleInjected) return;
    const style = document.createElement('style');
    style.id = 'settings-panel-style';
    style.textContent = `
      .settings-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(5, 7, 12, 0.72);
        backdrop-filter: blur(8px);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
      }
      .settings-panel {
        background: var(--panel);
        border: 1px solid var(--line2);
        border-radius: 12px;
        width: 420px;
        padding: 24px;
        color: var(--fg);
        font-family: sans-serif;
        box-sizing: border-box;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(6px);
      }
      .settings-title {
        margin: 0 0 20px 0;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--mut);
      }
      .quality-buttons {
        display: flex;
        gap: 0;
        margin-bottom: 20px;
      }
      .quality-btn {
        flex: 1;
        padding: 8px 0;
        background: #141a26;
        border: 1px solid var(--line2);
        border-radius: 0;
        color: var(--mut);
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: border-color 0.15s, background 0.15s, color 0.15s;
      }
      .quality-btn:first-child {
        border-radius: 7px 0 0 7px;
      }
      .quality-btn:last-child {
        border-radius: 0 7px 7px 0;
      }
      .quality-btn:hover { 
        border-color: var(--amber);
        color: var(--fg);
      }
      .quality-btn.active {
        background: var(--amber);
        border-color: var(--amber);
        color: #1a1204;
        font-weight: 800;
      }
      .slider-group {
        margin-bottom: 20px;
      }
      .slider-label {
        display: block;
        margin-bottom: 8px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--mut);
      }
      .slider-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .slider-group input[type=range] {
        flex: 1;
        -webkit-appearance: none;
        appearance: none;
        height: 6px;
        background: var(--line2);
        border-radius: 3px;
        outline: none;
        cursor: pointer;
        accent-color: var(--amber);
      }
      .slider-group input[type=range]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        background: var(--amber);
        border-radius: 50%;
        cursor: pointer;
      }
      .slider-group input[type=range]::-moz-range-thumb {
        width: 16px;
        height: 16px;
        background: var(--amber);
        border-radius: 50%;
        cursor: pointer;
        border: none;
      }
      .slider-group .live-label {
        min-width: 45px;
        text-align: right;
        font-size: 12px;
        font-family: var(--mono);
        font-variant-numeric: tabular-nums;
        color: var(--fg);
      }
      .checkbox-group {
        margin-bottom: 24px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .checkbox-group input[type=checkbox] {
        margin: 0;
        cursor: pointer;
      }
      .checkbox-group label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--mut);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .action-buttons {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 20px;
      }
      .action-btn {
        width: 100%;
        padding: 10px;
        background: #141a26;
        border: 1px solid var(--line2);
        border-radius: 7px;
        color: var(--mut);
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: border-color 0.15s, color 0.15s;
      }
      .action-btn:hover { 
        border-color: var(--amber);
        color: var(--fg);
      }
      .action-btn:focus-visible {
        outline: 2px solid var(--amber);
        outline-offset: 2px;
      }

    `;
    document.head.appendChild(style);
    SettingsPanel.styleInjected = true;
  }
}
