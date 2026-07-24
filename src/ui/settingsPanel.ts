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

type TabId = 'flight' | 'war' | 'audio' | 'rates' | 'keys';

const TABS: { id: TabId; label: string }[] = [
  { id: 'flight', label: 'Flight & View' },
  { id: 'war', label: 'War Mode' },
  { id: 'audio', label: 'Audio' },
  { id: 'rates', label: 'Rates' },
  { id: 'keys', label: 'Shortcuts' },
];

/** Keyboard/controller reference rendered on the Shortcuts tab. */
const SHORTCUT_GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Flight',
    rows: [
      ['↑ ↓ ← →', 'Pitch / Roll'],
      ['A / D', 'Yaw'],
      ['W / S', 'Throttle'],
      ['Enter', 'Arm / Disarm'],
      ['R', 'Respawn at checkpoint'],
      ['Shift + R', 'Restart race'],
      ['V', 'Camera FPV / chase'],
      ['Esc', 'Pause'],
    ],
  },
  {
    title: 'Combat',
    rows: [
      ['Space (hold)', 'Fire — auto-fire / charge railgun'],
      ['1 / 2 / 3', 'Blaster / Burst / Railgun'],
      ['Q', 'Next weapon'],
      ['Space or R', 'Skip killcam'],
    ],
  },
  {
    title: 'Panels & track editor',
    rows: [
      ['C', 'Controller & calibration'],
      ['T', 'Track editor on/off (BSP maps)'],
      ['G', 'Place gate at drone'],
      ['U', 'Undo last gate'],
      ['Backspace', 'Restart race'],
    ],
  },
  {
    title: 'Gamepad / DJI RC 3',
    rows: [
      ['Mode 2 sticks', 'Left = yaw+throttle · right = pitch+roll'],
      ['RB / RT', 'Next weapon / Fire (gamepad)'],
      ['Left-center switch', 'Next weapon (DJI RC)'],
      ['Controller panel', 'Full mapping & calibration wizard'],
    ],
  },
];

export class SettingsPanel {
  private readonly root: HTMLElement;
  private readonly deps: SettingsDeps;
  private overlayEl: HTMLDivElement | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private _open = false;
  private activeTab: TabId = 'flight';

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

  private showTab(id: TabId): void {
    this.activeTab = id;
    if (!this.overlayEl) return;
    this.overlayEl.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === id);
    });
    this.overlayEl.querySelectorAll<HTMLDivElement>('.tab-page').forEach((p) => {
      p.style.display = p.dataset.tab === id ? 'block' : 'none';
    });
  }

  private syncControls(): void {
    if (!this.overlayEl) return;
    const s = this.deps.settings;
    // Quality buttons
    this.overlayEl.querySelectorAll<HTMLButtonElement>('.quality-btn:not(.difficulty-btn)').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.quality === s.quality);
    });
    // Sliders + labels
    const setVal = (cls: string, value: string, label: string) => {
      const input = this.overlayEl!.querySelector<HTMLInputElement>(`.${cls}-slider`);
      const lab = this.overlayEl!.querySelector<HTMLSpanElement>(`.${cls}-value`);
      if (input) input.value = value;
      if (lab) lab.textContent = label;
    };
    setVal('uptilt', String(s.uptiltDeg), `${s.uptiltDeg}°`);
    setVal('fov', String(s.fovDeg), `${s.fovDeg}°`);
    setVal('chase', String(s.chaseStiffness), s.chaseStiffness.toFixed(1));
    setVal('volume', String(Math.round(s.volume * 100)), `${Math.round(s.volume * 100)}%`);
    // Checkboxes
    const check = (cls: string, on: boolean) => {
      const el = this.overlayEl!.querySelector<HTMLInputElement>(`.${cls}`);
      if (el) el.checked = on;
    };
    check('freefly-check', s.freeFly);
    check('bots-check', s.bots);
    check('killcam-check', s.killcam);
    this.overlayEl.querySelectorAll<HTMLButtonElement>('.difficulty-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.difficulty === s.botDifficulty);
    });

    // Rates & throttle (active device profile)
    const active = this.deps.rates?.get() ?? null;
    const devEl = this.overlayEl.querySelector<HTMLSpanElement>('.rates-device');
    if (devEl) devEl.textContent = active ? active.deviceId.slice(0, 34) : 'no device';
    if (active) {
      const a = active.profile.axes;
      setVal('rr', String(a.roll.rate ?? 400), `${a.roll.rate ?? 400}°/s`);
      setVal('pr', String(a.pitch.rate ?? 400), `${a.pitch.rate ?? 400}°/s`);
      setVal('yr', String(a.yaw.rate ?? 400), `${a.yaw.rate ?? 400}°/s`);
      setVal('rpx', String(a.roll.expo), a.roll.expo.toFixed(2));
      setVal('yx', String(a.yaw.expo), a.yaw.expo.toFixed(2));
      setVal('tx', String(a.throttle.expo), a.throttle.expo.toFixed(2));
      const lim = Math.round((a.throttle.limit ?? 1) * 100);
      setVal('tl', String(lim), `${lim}%`);
    }
    this.showTab(this.activeTab);
  }

  private _createDOM(): void {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('h2');
    title.className = 'settings-title';
    title.textContent = 'Settings';
    panel.appendChild(title);

    // ---- tab bar ----
    const tabBar = document.createElement('div');
    tabBar.className = 'tab-bar';
    for (const t of TABS) {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.dataset.tab = t.id;
      btn.textContent = t.label;
      btn.addEventListener('click', () => this.showTab(t.id));
      tabBar.appendChild(btn);
    }
    panel.appendChild(tabBar);

    const pages: Record<TabId, HTMLDivElement> = {} as Record<TabId, HTMLDivElement>;
    for (const t of TABS) {
      const page = document.createElement('div');
      page.className = 'tab-page';
      page.dataset.tab = t.id;
      page.style.display = 'none';
      panel.appendChild(page);
      pages[t.id] = page;
    }

    // ================= FLIGHT & VIEW =================
    const flight = pages.flight;
    const qualityLabel = document.createElement('label');
    qualityLabel.className = 'slider-label';
    qualityLabel.textContent = 'Render quality';
    flight.appendChild(qualityLabel);
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
    flight.appendChild(qualityContainer);

    this._appendSlider(flight, 'uptilt', 'FPV camera uptilt', '0', '40', '1', '°', (v) => {
      this.deps.settings.uptiltDeg = v;
      this.deps.apply.uptilt(v);
    });
    this._appendSlider(flight, 'fov', 'FPV FOV', '90', '140', '1', '°', (v) => {
      this.deps.settings.fovDeg = v;
      this.deps.apply.fov(v);
    });
    this._appendSlider(flight, 'chase', 'Chase smoothness', '8', '20', '0.1', '', (v) => {
      this.deps.settings.chaseStiffness = v;
      this.deps.apply.chaseStiffness(v);
    });
    this._appendCheckbox(flight, 'freefly-check', 'Free-fly mode', (on) => {
      this.deps.settings.freeFly = on;
      this.deps.apply.freeFly(on);
    });

    // ================= WAR MODE =================
    const war = pages.war;
    this._appendCheckbox(war, 'bots-check', 'Enemy bots (next map load)', (on) => {
      this.deps.settings.bots = on;
      this.deps.apply.bots(on);
    });
    const diffLabel = document.createElement('label');
    diffLabel.className = 'slider-label';
    diffLabel.textContent = 'Bot difficulty (next map load)';
    war.appendChild(diffLabel);
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
    war.appendChild(diffContainer);
    this._appendCheckbox(war, 'killcam-check', 'Killcam on death', (on) => {
      this.deps.settings.killcam = on;
      this.deps.apply.killcam(on);
    });

    // ================= AUDIO =================
    this._appendSlider(pages.audio, 'volume', 'Master volume', '0', '100', '1', '%', (v) => {
      this.deps.settings.volume = v / 100;
      this.deps.apply.volume(v / 100);
    });

    // ================= RATES =================
    const rates = pages.rates;
    const ratesHead = document.createElement('div');
    ratesHead.className = 'settings-title';
    ratesHead.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px';
    ratesHead.innerHTML = 'Rates & throttle <span class="rates-device" style="font:600 10px var(--mono);color:var(--mut);letter-spacing:0;text-transform:none"></span>';
    rates.appendChild(ratesHead);

    const prof = () => this.deps.rates?.get()?.profile ?? null;
    const persist = () => this.deps.rates?.persist();
    const rateSlider = (
      cls: string, label: string, min: string, max: string, step: string,
      set: (p: Profile, v: number) => void, fmt: (v: number) => string,
    ) => {
      this._appendSlider(rates, cls, label, min, max, step, '', (v) => {
        const p = prof();
        if (!p) return;
        set(p, v);
        persist();
        const lab = this.overlayEl?.querySelector<HTMLSpanElement>(`.${cls}-value`);
        if (lab) lab.textContent = fmt(v);
      });
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

    // ================= SHORTCUTS =================
    const keys = pages.keys;
    for (const group of SHORTCUT_GROUPS) {
      const h = document.createElement('div');
      h.className = 'keys-head';
      h.textContent = group.title;
      keys.appendChild(h);
      const table = document.createElement('div');
      table.className = 'keys-table';
      for (const [combo, what] of group.rows) {
        const k = document.createElement('span');
        k.className = 'keys-combo';
        k.textContent = combo;
        const w = document.createElement('span');
        w.className = 'keys-what';
        w.textContent = what;
        table.appendChild(k);
        table.appendChild(w);
      }
      keys.appendChild(table);
    }

    // ---- footer actions (visible on every tab) ----
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
    this.showTab('flight');
  }

  private _appendCheckbox(parent: HTMLElement, cls: string, label: string, onChange: (on: boolean) => void): void {
    const group = document.createElement('div');
    group.className = 'checkbox-group';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = cls;
    input.addEventListener('change', () => {
      onChange(input.checked);
      this.deps.save();
    });
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.prepend(input);
    group.appendChild(lab);
    parent.appendChild(group);
  }

  private _appendSlider(
    parent: HTMLElement,
    cls: string,
    labelText: string,
    min: string,
    max: string,
    step: string,
    suffix: string,
    onChange: (value: number) => void,
  ): void {
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
    input.className = `slider-input ${cls}-slider`;
    const liveValue = document.createElement('span');
    liveValue.className = `live-label ${cls}-value`;

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
    parent.appendChild(group);
  }

  private _injectStyles(): void {
    if (SettingsPanel.styleInjected) return;
    const style = document.createElement('style');
    style.id = 'settings-panel-style';
    style.textContent = `
      .settings-overlay {
        position: fixed;
        inset: 0;
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
        width: 460px;
        padding: 24px;
        color: var(--fg);
        font-family: sans-serif;
        box-sizing: border-box;
        max-height: 88vh;
        overflow-y: auto;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(6px);
      }
      .settings-title {
        margin: 0 0 14px 0;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--mut);
      }
      .tab-bar {
        display: flex;
        gap: 0;
        margin-bottom: 20px;
        border: 1px solid var(--line2);
        border-radius: 8px;
        overflow: hidden;
      }
      .tab-btn {
        flex: 1;
        padding: 8px 2px;
        background: #10151f;
        border: none;
        border-right: 1px solid var(--line2);
        color: var(--mut);
        cursor: pointer;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        transition: background 0.15s, color 0.15s;
      }
      .tab-btn:last-child { border-right: none; }
      .tab-btn:hover { color: var(--fg); }
      .tab-btn.active {
        background: var(--amber);
        color: #1a1204;
        font-weight: 800;
      }
      .tab-page { min-height: 220px; }
      .keys-head {
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--amber);
        margin: 14px 0 8px;
      }
      .keys-head:first-child { margin-top: 0; }
      .keys-table {
        display: grid;
        grid-template-columns: 120px 1fr;
        gap: 5px 14px;
        align-items: baseline;
      }
      .keys-combo {
        font-family: var(--mono);
        font-size: 11px;
        font-weight: 700;
        color: var(--fg);
        background: #10151f;
        border: 1px solid var(--line2);
        border-radius: 5px;
        padding: 2px 7px;
        text-align: center;
        white-space: nowrap;
      }
      .keys-what {
        font-size: 11px;
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
      .quality-btn:first-child { border-radius: 7px 0 0 7px; }
      .quality-btn:last-child { border-radius: 0 7px 7px 0; }
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
      .slider-group { margin-bottom: 20px; }
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
        margin-bottom: 20px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .checkbox-group input[type=checkbox] { margin: 0; cursor: pointer; }
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
        border-top: 1px solid var(--line2);
        padding-top: 16px;
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
