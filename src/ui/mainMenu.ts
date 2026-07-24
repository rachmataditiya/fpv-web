interface MapItem {
  id: string;
  label: string;
  kind: 'builtin' | 'custom' | 'server';
}

export interface MainMenuDeps {
  listMaps(): Promise<MapItem[]>;
  play(mapId: string): void;
  resume(): void;
  openMissions(): void;
  openCareer(): void;
  openSettings(): void;
  openController(): void;
  openGarage(): void;
  version: string;
}

type ButtonAction = 'resume' | 'maps' | 'missions' | 'career' | 'garage' | 'settings' | 'controller';

export class MainMenu {
  private static styleInjected = false;

  private root: HTMLElement;
  private deps: MainMenuDeps;
  private overlay: HTMLDivElement | null = null;
  private backdrop: HTMLDivElement | null = null;
  private menuContainer: HTMLDivElement | null = null;
  private footer: HTMLDivElement | null = null;
  private mapsSubview: HTMLDivElement | null = null;
  private mapsGrid: HTMLDivElement | null = null;
  private mapBackBtn: HTMLButtonElement | null = null;
  private mainButtons: HTMLButtonElement[] = [];
  private mapCards: HTMLButtonElement[] = [];
  private focusedIndex: number = 0;
  private currentView: 'main' | 'maps' = 'main';
  private openState: boolean = false;

  constructor(root: HTMLElement, deps: MainMenuDeps) {
    this.root = root;
    this.deps = deps;
  }

  public open(): void {
    if (!MainMenu.styleInjected) {
      MainMenu._injectStyles();
      MainMenu.styleInjected = true;
    }

    if (this.openState) return;
    this.openState = true;

    // never stack menus — purge any stale overlay before building a fresh one
    this.root.querySelectorAll('.fpv-mainmenu-overlay').forEach((n) => n.remove());
    this._createDOM();
    this._attachEvents();
    this.root.appendChild(this.overlay!);
    this.overlay!.classList.add('active');
    this._focusMainButton('resume');
  }

  public close(): void {
    if (!this.openState) return;
    this.openState = false;

    this._removeEvents();
    if (this.overlay) {
      this.overlay.classList.remove('active');
      // parent-agnostic AND stale-proof: removeChild(root, …) threw
      // NotFoundError when the overlay got re-parented, wedging the menu open
      this.overlay.remove();
      this.root.querySelectorAll('.fpv-mainmenu-overlay').forEach((n) => n.remove());
      this.overlay = null;
    }
    this.menuContainer = null;
    this.backdrop = null;
    this.footer = null;
    this.mapsSubview = null;
    this.mapsGrid = null;
    this.mapBackBtn = null;
    this.mainButtons = [];
    this.mapCards = [];
    this.currentView = 'main';
    this.focusedIndex = 0;
  }

  public get isOpen(): boolean {
    return this.openState;
  }

  private static _injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      .fpv-mainmenu-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
        background: rgba(0,0,0,0.85);
      }
      .fpv-mainmenu-overlay.active {
        opacity: 1;
        pointer-events: auto;
      }
      .fpv-mainmenu-backdrop {
        position: absolute;
        inset: 0;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }
      .fpv-mainmenu-container {
        position: relative;
        width: 460px;
        max-width: 95vw;
        background: var(--panel, rgba(20,20,30,0.95));
        border: 1px solid var(--line2, rgba(255,255,255,0.15));
        border-radius: 8px;
        padding: 2rem 0 1rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        color: var(--fg, #ddd);
        font-family: 'Orbitron', 'Courier New', monospace;
        box-shadow: 0 0 35px rgba(0,0,0,0.7);
        overflow: hidden;
      }
      .fpv-title {
        font-size: 2.4rem;
        letter-spacing: 0.15em;
        color: var(--amber, #ffa500);
        text-transform: uppercase;
        font-weight: bold;
        margin: 0;
        text-align: center;
        text-shadow: 0 0 12px var(--amber);
      }
      .fpv-subtitle {
        font-size: 0.9rem;
        letter-spacing: 0.6em;
        color: var(--mut, #aaa);
        margin: 0.2rem 0 2.2rem;
        text-transform: uppercase;
      }
      .fpv-main-buttons {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 86%;
        align-items: stretch;
      }
      .fpv-btn {
        font-family: inherit;
        font-size: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.15em;
        padding: 0.85rem 1.2rem;
        border: 1px solid var(--line2, rgba(255,255,255,0.2));
        background: var(--panel, rgba(25,25,35,0.8));
        color: var(--fg, #ccc);
        cursor: pointer;
        transition: all 0.15s;
        text-align: left;
        position: relative;
        border-radius: 4px;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .fpv-btn::before {
        content: '▶';
        color: var(--amber);
        font-size: 0.8rem;
        opacity: 0;
        transition: opacity 0.15s;
      }
      .fpv-btn.focused {
        background: var(--amber);
        color: #000;
        border-color: var(--amber);
        font-weight: bold;
      }
      .fpv-btn.focused::before {
        opacity: 1;
      }
      .fpv-btn:hover {
        background: var(--amber);
        color: #000;
        border-color: var(--amber);
      }
      .fpv-btn:hover::before {
        opacity: 1;
      }
      .fpv-footer {
        margin-top: 1.8rem;
        font-size: 0.75rem;
        color: var(--mut, #777);
        text-align: center;
        letter-spacing: 0.1em;
        line-height: 1.5;
      }
      .fpv-maps-subview {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        padding: 0 1.5rem;
        box-sizing: border-box;
      }
      .fpv-maps-title {
        font-size: 1.2rem;
        color: var(--amber);
        text-transform: uppercase;
        letter-spacing: 0.2em;
        margin-bottom: 1rem;
      }
      .fpv-maps-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 10px;
        width: 100%;
        margin-bottom: 1.2rem;
        max-height: 320px;
        overflow-y: auto;
        padding: 0.5rem;
      }
      .fpv-map-card {
        font-family: inherit;
        background: var(--panel, rgba(30,30,40,0.9));
        border: 1px solid var(--line2, rgba(255,255,255,0.1));
        border-radius: 6px;
        padding: 0.8rem;
        color: var(--fg);
        cursor: pointer;
        transition: all 0.15s;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        position: relative;
      }
      .fpv-map-card.focused {
        background: var(--amber);
        color: #000;
        border-color: var(--amber);
      }
      .fpv-map-card:hover {
        background: var(--amber);
        color: #000;
        border-color: var(--amber);
      }
      .fpv-map-label {
        font-size: 0.9rem;
        font-weight: bold;
      }
      .fpv-map-badge {
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        padding: 0.15em 0.5em;
        border-radius: 3px;
        align-self: flex-start;
        background: var(--amber);
        color: #000;
      }
      .fpv-map-badge.builtin { background: var(--amber); color: #000; }
      .fpv-map-badge.custom { background: var(--green, #0f0); color: #000; }
      .fpv-map-badge.server { background: #3a8eff; color: #fff; }
      .fpv-back-btn {
        font-family: inherit;
        text-transform: uppercase;
        background: transparent;
        border: 1px solid var(--mut);
        color: var(--mut);
        padding: 0.5rem 1.2rem;
        cursor: pointer;
        border-radius: 4px;
        margin-top: 0.4rem;
      }
      .fpv-back-btn:hover, .fpv-back-btn.focused {
        border-color: var(--amber);
        color: var(--amber);
      }
    `;
    document.head.appendChild(style);
  }

  private _createDOM(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'fpv-mainmenu-overlay';

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'fpv-mainmenu-backdrop';

    this.menuContainer = document.createElement('div');
    this.menuContainer.className = 'fpv-mainmenu-container';

    // Build main view
    const title = document.createElement('h1');
    title.className = 'fpv-title';
    title.textContent = 'FPV WEB';
    const subtitle = document.createElement('p');
    subtitle.className = 'fpv-subtitle';
    subtitle.textContent = 'WAR OPS SIMULATOR';

    // Main buttons (only seven)
    const mainBtnWrapper = document.createElement('div');
    mainBtnWrapper.className = 'fpv-main-buttons';

    const createMainButton = (label: string, action: ButtonAction): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.className = 'fpv-btn';
      btn.dataset.action = action;
      btn.textContent = label;
      return btn;
    };

    const resumeBtn = createMainButton('RESUME', 'resume');
    const mapsBtn = createMainButton('MAPS', 'maps');
    const missionsBtn = createMainButton('WAR OPS', 'missions');
    const careerBtn = createMainButton('CAREER', 'career');
    const garageBtn = createMainButton('GARAGE', 'garage');
    const settingsBtn = createMainButton('SETTINGS', 'settings');
    const controllerBtn = createMainButton('CONTROLLER', 'controller');

    this.mainButtons = [
      resumeBtn, mapsBtn, missionsBtn, careerBtn, garageBtn, settingsBtn, controllerBtn
    ];
    this.mainButtons.forEach(btn => mainBtnWrapper.appendChild(btn));

    // Footer
    this.footer = document.createElement('div');
    this.footer.className = 'fpv-footer';
    this.footer.innerHTML = `${this.deps.version}<br>Press Esc to resume`;

    // Maps subview (hidden initially)
    this.mapsSubview = document.createElement('div');
    this.mapsSubview.className = 'fpv-maps-subview';
    this.mapsSubview.style.display = 'none';

    const mapsTitle = document.createElement('h2');
    mapsTitle.className = 'fpv-maps-title';
    mapsTitle.textContent = 'SELECT MAP';
    this.mapsSubview.appendChild(mapsTitle);

    this.mapsGrid = document.createElement('div');
    this.mapsGrid.className = 'fpv-maps-grid';
    this.mapsSubview.appendChild(this.mapsGrid);

    this.mapBackBtn = document.createElement('button');
    this.mapBackBtn.className = 'fpv-back-btn';
    this.mapBackBtn.textContent = '← BACK';
    this.mapsSubview.appendChild(this.mapBackBtn);

    this.menuContainer.appendChild(title);
    this.menuContainer.appendChild(subtitle);
    this.menuContainer.appendChild(mainBtnWrapper);
    this.menuContainer.appendChild(this.mapsSubview);
    this.menuContainer.appendChild(this.footer);

    this.overlay.appendChild(this.backdrop);
    this.overlay.appendChild(this.menuContainer);
  }

  private _attachEvents(): void {
    // Keyboard global
    document.addEventListener('keydown', this._handleKeyDown);

    // Main button clicks
    this.mainButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action as ButtonAction;
        this._handleAction(action);
      });
      btn.addEventListener('mouseenter', () => {
        this._focusButton(btn);
      });
    });

    // Backdrop click close
    if (this.backdrop) {
      this.backdrop.addEventListener('click', () => {
        this.deps.resume();
      });
    }

    // Map back button
    if (this.mapBackBtn) {
      this.mapBackBtn.addEventListener('click', () => this._showMainView());
    }

    // Load maps on open
    this._preloadMaps();
  }

  private _removeEvents(): void {
    document.removeEventListener('keydown', this._handleKeyDown);
    if (this.overlay) {
      this.overlay.replaceWith(this.overlay.cloneNode(true)); // kill listeners
    }
  }

  private _handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.openState) return;

    if (this.currentView === 'main') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        this.focusedIndex = (this.focusedIndex + dir + this.mainButtons.length) % this.mainButtons.length;
        this._focusButtonByIndex();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const focusedBtn = this.mainButtons[this.focusedIndex];
        if (focusedBtn) {
          const action = focusedBtn.dataset.action as ButtonAction;
          this._handleAction(action);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.deps.resume();
      }
    } else if (this.currentView === 'maps') {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._showMainView();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const cols = window.innerWidth <= 480 ? 1 : 3; // approximate columns
        const items = this.mapCards;
        if (items.length === 0) return;
        let newIdx = this.focusedIndex;
        if (e.key === 'ArrowRight') newIdx = Math.min(newIdx + 1, items.length - 1);
        if (e.key === 'ArrowLeft') newIdx = Math.max(newIdx - 1, 0);
        if (e.key === 'ArrowDown') newIdx = Math.min(newIdx + cols, items.length - 1);
        if (e.key === 'ArrowUp') newIdx = Math.max(newIdx - cols, 0);
        this.focusedIndex = newIdx;
        this._focusMapCardByIndex();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const card = this.mapCards[this.focusedIndex];
        if (card) {
          this.deps.play(card.dataset.mapId!);
        }
      }
    }
  };

  private _handleAction(action: ButtonAction): void {
    switch (action) {
      case 'resume': this.deps.resume(); break;
      case 'maps': this._showMapsView(); break;
      case 'missions': this.deps.openMissions(); break;
      case 'career': this.deps.openCareer(); break;
      case 'garage': this.deps.openGarage(); break;
      case 'settings': this.deps.openSettings(); break;
      case 'controller': this.deps.openController(); break;
    }
  }

  private async _preloadMaps(): Promise<void> {
    if (!this.mapsGrid) return;
    try {
      const maps = await this.deps.listMaps();
      this._renderMapCards(maps);
    } catch (err) {
      console.warn('Failed to load map list:', err);
    }
  }

  private _renderMapCards(maps: MapItem[]): void {
    if (!this.mapsGrid) return;
    this.mapsGrid.innerHTML = '';
    this.mapCards = [];
    maps.forEach((map, idx) => {
      const card = document.createElement('button');
      card.className = 'fpv-map-card';
      card.dataset.mapId = map.id;
      card.innerHTML = `
        <span class="fpv-map-label">${map.label}</span>
        <span class="fpv-map-badge ${map.kind}">${map.kind.toUpperCase()}</span>
      `;
      card.addEventListener('click', () => {
        this.deps.play(map.id);
      });
      card.addEventListener('mouseenter', () => {
        this.focusedIndex = idx;
        this._focusMapCardByIndex();
      });
      if (this.mapsGrid) this.mapsGrid.appendChild(card);
      this.mapCards.push(card);
    });
    if (this.mapCards.length > 0) {
      this.focusedIndex = 0;
      this._focusMapCardByIndex();
    }
  }

  private _showMainView(): void {
    if (!this.mapsSubview || !this.footer) return;
    this.currentView = 'main';
    this.mapsSubview.style.display = 'none';
    this.footer.style.display = '';
    // Restore main buttons display
    const mainBtnWrapper = this.menuContainer?.querySelector('.fpv-main-buttons') as HTMLElement;
    if (mainBtnWrapper) mainBtnWrapper.style.display = '';
    this._focusMainButton('resume');
  }

  private _showMapsView(): void {
    if (!this.mapsSubview || !this.footer) return;
    this.currentView = 'maps';
    const mainBtnWrapper = this.menuContainer?.querySelector('.fpv-main-buttons') as HTMLElement;
    if (mainBtnWrapper) mainBtnWrapper.style.display = 'none';
    this.footer.style.display = 'none';
    this.mapsSubview.style.display = 'flex';
    // focus first map card
    if (this.mapCards.length > 0) {
      this.focusedIndex = 0;
      this._focusMapCardByIndex();
    }
  }

  private _focusButton(btn: HTMLButtonElement): void {
    this.mainButtons.forEach(b => b.classList.remove('focused'));
    btn.classList.add('focused');
  }

  private _focusButtonByIndex(): void {
    const idx = this.focusedIndex;
    if (idx >= 0 && idx < this.mainButtons.length) {
      this._focusButton(this.mainButtons[idx]);
    }
  }

  private _focusMainButton(action: ButtonAction): void {
    const idx = this.mainButtons.findIndex(b => b.dataset.action === action);
    if (idx !== -1) {
      this.focusedIndex = idx;
      this._focusButtonByIndex();
    }
  }

  private _focusMapCardByIndex(): void {
    this.mapCards.forEach((c, i) => c.classList.toggle('focused', i === this.focusedIndex));
    const card = this.mapCards[this.focusedIndex];
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
