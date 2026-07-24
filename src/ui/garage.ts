import * as THREE from 'three';
import { createDroneMesh } from '../render/drone';

interface SkinInfo {
  id: string;
  label: string;
  previewColor: string; // CSS color for chip preview
}

export interface GarageDeps {
  getAccent(): number;          // returns hex color like 0xff8000
  setAccent(hex: number): void;
  getSkin(): string;            // returns current skin id
  setSkin(id: string): void;
}

const SKIN_LIST: SkinInfo[] = [
  { id: 'stealth', label: 'STEALTH', previewColor: '#222' },
  { id: 'desert', label: 'DESERT', previewColor: '#c8a14c' },
  { id: 'neon', label: 'NEON', previewColor: '#0ff' },
];

const ACCENT_SWATCHES = [
  { color: 0xff8000, label: 'Orange' },
  { color: 0xff2222, label: 'Red' },
  { color: 0x00ffff, label: 'Cyan' },
  { color: 0x00ff00, label: 'Lime' },
  { color: 0xff00ff, label: 'Magenta' },
  { color: 0xffffff, label: 'White' },
];

export class Garage {
  private static styleInjected = false;

  private root: HTMLElement;
  private deps: GarageDeps;
  private overlay: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private droneMesh: THREE.Group | null = null;
  private animationFrameId: number | null = null;
  private accentHex: number = 0xff8000;
  private currentSkin: string = 'stealth';
  private openState: boolean = false;

  constructor(root: HTMLElement, deps: GarageDeps) {
    this.root = root;
    this.deps = deps;
  }

  public open(): void {
    if (!Garage.styleInjected) {
      Garage._injectStyles();
      Garage.styleInjected = true;
    }
    if (this.openState) return;
    this.openState = true;

    // sync from deps
    this.accentHex = this.deps.getAccent();
    this.currentSkin = this.deps.getSkin();

    this._createDOM();
    this._initThree();
    this._updateSwatchesUI();
    this._updateSkinUI();
    this._startAnimationLoop();
    this._attachEvents();

    this.root.appendChild(this.overlay!);
    // fade-in handled by CSS
  }

  public close(): void {
    if (!this.openState) return;
    this.openState = false;

    this._stopAnimationLoop();
    this._disposeThree();
    this._removeEvents();

    if (this.overlay) {
      this.root.removeChild(this.overlay);
      this.overlay = null;
    }
    this.panel = null;
    this.canvas = null;
  }

  public get isOpen(): boolean {
    return this.openState;
  }

  private static _injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      .fpv-garage-overlay {
        position: fixed;
        inset: 0;
        z-index: 9998;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,0.8);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        pointer-events: auto;
        opacity: 1;
        transition: opacity 0.2s;
      }
      .fpv-garage-panel {
        display: flex;
        background: var(--panel, rgba(18,19,26,0.95));
        border: 1px solid var(--line2, rgba(255,255,255,0.12));
        border-radius: 10px;
        padding: 1.5rem;
        gap: 1.8rem;
        align-items: flex-start;
        box-shadow: 0 0 40px rgba(0,0,0,0.7);
      }
      .fpv-garage-preview {
        width: 300px;
        height: 220px;
        border: 1px solid var(--line2);
        background: #000;
        border-radius: 4px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .fpv-garage-preview canvas {
        display: block;
      }
      .fpv-garage-controls {
        display: flex;
        flex-direction: column;
        min-width: 220px;
      }
      .fpv-garage-title {
        font-family: 'Orbitron', monospace;
        color: var(--amber, #ffa500);
        font-size: 1.8rem;
        text-transform: uppercase;
        letter-spacing: 0.2em;
        margin: 0 0 1.2rem;
        text-shadow: 0 0 8px var(--amber);
      }
      .fpv-garage-section-label {
        font-family: monospace;
        color: var(--fg, #ccc);
        text-transform: uppercase;
        font-size: 0.8rem;
        letter-spacing: 0.15em;
        margin-bottom: 0.5rem;
      }
      .fpv-swatch-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin-bottom: 1.2rem;
      }
      .fpv-swatch {
        width: 40px;
        height: 40px;
        border-radius: 4px;
        cursor: pointer;
        border: 2px solid transparent;
        transition: 0.1s;
        background-color: var(--swatch-color);
      }
      .fpv-swatch.active {
        border-color: var(--amber);
        box-shadow: 0 0 10px var(--amber);
      }
      .fpv-skin-chips {
        display: flex;
        gap: 8px;
        margin-bottom: 1.5rem;
      }
      .fpv-skin-chip {
        font-family: monospace;
        padding: 0.4rem 0.7rem;
        background: var(--panel, rgba(30,30,40,0.9));
        border: 1px solid var(--line2);
        color: var(--fg);
        border-radius: 4px;
        cursor: pointer;
        text-transform: uppercase;
        font-size: 0.7rem;
        letter-spacing: 0.1em;
        display: flex;
        align-items: center;
        gap: 0.3rem;
      }
      .fpv-skin-chip.active {
        border-color: var(--amber);
        background: var(--amber);
        color: #000;
      }
      .fpv-skin-preview-dot {
        width: 10px;
        height: 10px;
        border-radius: 2px;
        background: var(--skin-color);
        display: inline-block;
      }
      .fpv-apply-btn {
        font-family: inherit;
        text-transform: uppercase;
        background: var(--amber);
        border: none;
        color: #000;
        padding: 0.7rem;
        font-weight: bold;
        cursor: pointer;
        border-radius: 4px;
        transition: opacity 0.15s;
      }
      .fpv-apply-btn.applied {
        opacity: 0.5;
      }
      .fpv-garage-msg {
        font-size: 0.7rem;
        color: var(--green);
        margin-top: 0.3rem;
        opacity: 0;
        transition: opacity 0.3s;
      }
      .fpv-garage-msg.show {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  private _createDOM(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'fpv-garage-overlay';

    this.panel = document.createElement('div');
    this.panel.className = 'fpv-garage-panel';

    // left: canvas preview
    const previewDiv = document.createElement('div');
    previewDiv.className = 'fpv-garage-preview';
    this.canvas = document.createElement('canvas');
    this.canvas.width = 300;
    this.canvas.height = 220;
    previewDiv.appendChild(this.canvas);

    // right: controls
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'fpv-garage-controls';

    const title = document.createElement('h2');
    title.className = 'fpv-garage-title';
    title.textContent = 'GARAGE';

    // accent section
    const accentLabel = document.createElement('div');
    accentLabel.className = 'fpv-garage-section-label';
    accentLabel.textContent = 'ACCENT COLOR';

    const swatchGrid = document.createElement('div');
    swatchGrid.className = 'fpv-swatch-grid';
    ACCENT_SWATCHES.forEach(sw => {
      const swatch = document.createElement('div');
      swatch.className = 'fpv-swatch';
      swatch.dataset.hex = sw.color.toString(16);
      swatch.style.setProperty('--swatch-color', `#${sw.color.toString(16).padStart(6, '0')}`);
      swatch.addEventListener('click', () => this._onAccentSelect(sw.color));
      swatchGrid.appendChild(swatch);
    });

    // skin section
    const skinLabel = document.createElement('div');
    skinLabel.className = 'fpv-garage-section-label';
    skinLabel.textContent = 'SKIN';

    const skinChips = document.createElement('div');
    skinChips.className = 'fpv-skin-chips';
    SKIN_LIST.forEach(skin => {
      const chip = document.createElement('div');
      chip.className = 'fpv-skin-chip';
      chip.dataset.skinId = skin.id;
      chip.innerHTML = `<span class="fpv-skin-preview-dot" style="--skin-color:${skin.previewColor}"></span>${skin.label}`;
      chip.addEventListener('click', () => this._onSkinSelect(skin.id));
      skinChips.appendChild(chip);
    });

    // apply & message
    const applyBtn = document.createElement('button');
    applyBtn.className = 'fpv-apply-btn';
    applyBtn.textContent = 'APPLY';
    applyBtn.addEventListener('click', () => this._onApply());

    const msg = document.createElement('div');
    msg.className = 'fpv-garage-msg';

    controlsDiv.appendChild(title);
    controlsDiv.appendChild(accentLabel);
    controlsDiv.appendChild(swatchGrid);
    controlsDiv.appendChild(skinLabel);
    controlsDiv.appendChild(skinChips);
    controlsDiv.appendChild(applyBtn);
    controlsDiv.appendChild(msg);

    this.panel.appendChild(previewDiv);
    this.panel.appendChild(controlsDiv);
    this.overlay.appendChild(this.panel);
  }

  private _initThree(): void {
    if (!this.canvas) return;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setSize(300, 220, false);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 300 / 220, 0.1, 100);
    this.camera.position.set(3, 1.5, 4);
    this.camera.lookAt(0, 0, 0);

    // lighting
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.5);
    dir.position.set(1, 2, 1);
    this.scene.add(dir);

    // drone mesh
    this.droneMesh = createDroneMesh({ accent: this.accentHex });
    this.scene.add(this.droneMesh);
  }

  private _startAnimationLoop(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    const animate = () => {
      if (!this.openState) return;
      if (this.droneMesh) {
        this.droneMesh.rotation.y += 0.01;
      }
      this.renderer!.render(this.scene!, this.camera!);
      this.animationFrameId = requestAnimationFrame(animate);
    };
    this.animationFrameId = requestAnimationFrame(animate);
  }

  private _stopAnimationLoop(): void {
    if (this.animationFrameId != null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private _disposeThree(): void {
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.droneMesh = null;
  }

  private _attachEvents(): void {
    document.addEventListener('keydown', this._handleKeyDown);
    // close on backdrop click (only if clicking overlay background, not panel)
    this.overlay?.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  private _removeEvents(): void {
    document.removeEventListener('keydown', this._handleKeyDown);
  }

  private _handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.openState) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  };

  private _onAccentSelect(hex: number): void {
    this.accentHex = hex;
    // update preview drone
    if (this.droneMesh) {
      this.scene?.remove(this.droneMesh);
      this.droneMesh = createDroneMesh({ accent: hex });
      this.scene?.add(this.droneMesh);
    }
    this._updateSwatchesUI();
  }

  private _updateSwatchesUI(): void {
    const swatches = this.panel?.querySelectorAll('.fpv-swatch');
    if (!swatches) return;
    swatches.forEach(s => {
      const hexStr = s.getAttribute('data-hex');
      const isActive = hexStr === this.accentHex.toString(16);
      s.classList.toggle('active', isActive);
    });
  }

  private _onSkinSelect(id: string): void {
    this.currentSkin = id;
    this._updateSkinUI();
  }

  private _updateSkinUI(): void {
    const chips = this.panel?.querySelectorAll('.fpv-skin-chip');
    if (!chips) return;
    chips.forEach(c => {
      const skinId = c.getAttribute('data-skin-id');
      c.classList.toggle('active', skinId === this.currentSkin);
    });
  }

  private _onApply(): void {
    this.deps.setAccent(this.accentHex);
    this.deps.setSkin(this.currentSkin);

    const btn = this.panel?.querySelector('.fpv-apply-btn') as HTMLButtonElement | null;
    const msg = this.panel?.querySelector('.fpv-garage-msg') as HTMLDivElement | null;
    if (btn) {
      btn.classList.add('applied');
      btn.textContent = 'APPLIED';
      setTimeout(() => {
        if (btn) {
          btn.classList.remove('applied');
          btn.textContent = 'APPLY';
        }
      }, 2000);
    }
    if (msg) {
      msg.textContent = 'APPLIED — NEXT MAP LOAD';
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 2000);
    }
  }
}
