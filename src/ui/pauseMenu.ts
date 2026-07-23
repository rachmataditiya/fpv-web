export interface PauseDeps {
  resume(): void;
  restart(): void;
  openSettings(): void;
}

export class PauseMenu {
  private readonly root: HTMLElement;
  private readonly deps: PauseDeps;
  private overlayEl: HTMLDivElement | null = null;
  private _visible = false;

  private static styleInjected = false;

  constructor(root: HTMLElement, deps: PauseDeps) {
    this.root = root;
    this.deps = deps;
    this._injectStyles();
    this._createDOM();
  }

  show(): void {
    if (this._visible) return;
    this._visible = true;
    if (this.overlayEl) this.overlayEl.style.display = 'flex';
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    if (this.overlayEl) this.overlayEl.style.display = 'none';
  }

  get visible(): boolean {
    return this._visible;
  }

  private _createDOM(): void {
    const overlay = document.createElement('div');
    overlay.className = 'pause-overlay';
    overlay.style.display = 'none';

    const content = document.createElement('div');
    content.className = 'pause-content';

    const title = document.createElement('h1');
    title.className = 'pause-title';
    title.textContent = 'PAUSED';
    content.appendChild(title);

    const resumeBtn = this._createButton('Resume', () => this.deps.resume());
    content.appendChild(resumeBtn);

    const restartBtn = this._createButton('Restart race', () => this.deps.restart());
    content.appendChild(restartBtn);

    const settingsBtn = this._createButton('Settings', () => this.deps.openSettings());
    content.appendChild(settingsBtn);

    const hint = document.createElement('p');
    hint.className = 'pause-hint';
    hint.textContent = 'ESC to resume · V camera · R respawn · Shift+R restart · C controller';
    content.appendChild(hint);

    overlay.appendChild(content);
    this.root.appendChild(overlay);
    this.overlayEl = overlay;
  }

  private _createButton(text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'pause-btn';
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private _injectStyles(): void {
    if (PauseMenu.styleInjected) return;
    const style = document.createElement('style');
    style.id = 'pause-menu-style';
    style.textContent = `
      .pause-overlay {
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
        color: var(--fg);
        font-family: sans-serif;
        animation: pauseFadeSlide 160ms ease-out both;
      }
      .pause-content {
        text-align: center;
      }
      .pause-title {
        font-size: 28px;
        font-weight: 800;
        margin: 0 0 40px 0;
        user-select: none;
        color: var(--fg);
        letter-spacing: 0.3em;
        text-transform: uppercase;
      }
      .pause-btn {
        display: block;
        width: 220px;
        padding: 12px 0;
        margin: 12px auto;
        background: #141a26;
        border: 1px solid var(--line2);
        border-radius: 7px;
        color: var(--mut);
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: border-color 0.15s, color 0.15s, background 0.15s;
        text-transform: uppercase;
      }
      .pause-btn:hover { 
        border-color: var(--amber);
        color: var(--fg);
      }
      .pause-btn:focus-visible {
        outline: 2px solid var(--amber);
        outline-offset: 2px;
      }
      .pause-hint {
        margin-top: 40px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--mut);
        user-select: none;
      }
      @keyframes pauseFadeSlide {
        from {
          opacity: 0;
          transform: translateY(12px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pause-overlay {
          animation: none;
        }
      }

    `;
    document.head.appendChild(style);
    PauseMenu.styleInjected = true;
  }
}
