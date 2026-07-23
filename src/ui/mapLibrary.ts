import { saveMap, listMaps, deleteMap, type StoredMap, type StoredMapMeta } from '../world/bsp/mapStore';
import { listServerMaps, type ServerMap } from '../world/bsp/serverMaps';

export interface MapLibraryDeps {
  flyMap(name: string): void;
  /** Fly a map hosted in the server's /maps/ folder. */
  flyServerMap?(name: string): void;
  onClose?: () => void;
}

export class MapLibrary {
  private root: HTMLElement;
  private deps: MapLibraryDeps;
  private _isOpen = false;
  private overlay: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private statusEl: HTMLSpanElement | null = null;
  private listContainer: HTMLDivElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private dropZone: HTMLDivElement | null = null;
  private deleting = new Map<string, boolean>();
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundBackdropClick: ((e: MouseEvent) => void) | null = null;
  private boundPanelClick: ((e: MouseEvent) => void) | null = null;
  private boundFileInputChange: ((e: Event) => void) | null = null;

  private static styleInjected = false;

  constructor(root: HTMLElement, deps: MapLibraryDeps) {
    this.root = root;
    this.deps = deps;
    if (!MapLibrary.styleInjected) {
      this._injectStyles();
      MapLibrary.styleInjected = true;
    }
    // Defer DOM creation until first open
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(): void {
    if (this._isOpen) return;
    this._isOpen = true;
    if (!this.overlay) {
      this._createDOM();
    }
    this.overlay!.style.display = 'flex';
    this._attachListeners();
    this._renderMapList();
  }

  close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    if (this.overlay) {
      this.overlay.style.display = 'none';
    }
    this._removeListeners();
    this.deleting.clear();
    this.deps.onClose?.();
  }

  private _attachListeners(): void {
    this.boundKeyDown = this._onKeyDown.bind(this);
    document.addEventListener('keydown', this.boundKeyDown);

    this.boundBackdropClick = this._onBackdropClick.bind(this);
    this.overlay!.addEventListener('click', this.boundBackdropClick);

    this.boundPanelClick = (e: MouseEvent) => e.stopPropagation();
    this.panel!.addEventListener('click', this.boundPanelClick);

    this.boundFileInputChange = this._onFileInputChange.bind(this);
    this.fileInput!.addEventListener('change', this.boundFileInputChange);

    this.dropZone!.addEventListener('dragover', this._onDragOver);
    this.dropZone!.addEventListener('dragleave', this._onDragLeave);
    this.dropZone!.addEventListener('drop', this._onDrop);
    this.dropZone!.addEventListener('click', this._onDropZoneClick);
  }

  private _removeListeners(): void {
    if (this.boundKeyDown) {
      document.removeEventListener('keydown', this.boundKeyDown);
      this.boundKeyDown = null;
    }
    if (this.boundBackdropClick) {
      this.overlay!.removeEventListener('click', this.boundBackdropClick);
      this.boundBackdropClick = null;
    }
    if (this.boundPanelClick) {
      this.panel!.removeEventListener('click', this.boundPanelClick);
      this.boundPanelClick = null;
    }
    if (this.boundFileInputChange) {
      this.fileInput!.removeEventListener('change', this.boundFileInputChange);
      this.boundFileInputChange = null;
    }
    this.dropZone!.removeEventListener('dragover', this._onDragOver);
    this.dropZone!.removeEventListener('dragleave', this._onDragLeave);
    this.dropZone!.removeEventListener('drop', this._onDrop);
    this.dropZone!.removeEventListener('click', this._onDropZoneClick);
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // Only close if this panel is topmost (isOpen and no deeper overlays – simple check)
      this.close();
    }
  }

  private _onBackdropClick(e: MouseEvent): void {
    // Backdrop click closes if clicking directly on overlay (not on panel)
    if (e.target === this.overlay) {
      this.close();
    }
  }

  private _onDragOver = (e: DragEvent): void => {
    e.preventDefault();
    this.dropZone!.classList.add('dragover');
  };

  private _onDragLeave = (): void => {
    this.dropZone!.classList.remove('dragover');
  };

  private _onDrop = (e: DragEvent): void => {
    e.preventDefault();
    this.dropZone!.classList.remove('dragover');
    if (e.dataTransfer?.files) {
      this._handleFiles(e.dataTransfer.files);
    }
  };

  private _onDropZoneClick = (): void => {
    this.fileInput!.value = '';
    this.fileInput!.click();
  };

  private _onFileInputChange = (e: Event): void => {
    const input = e.target as HTMLInputElement;
    if (input.files) {
      this._handleFiles(input.files);
    }
  };

  private async _handleFiles(fileList: FileList): Promise<void> {
    const files = Array.from(fileList);
    const bspFiles = files.filter(f => f.name.endsWith('.bsp'));
    const wadFiles = files.filter(f => f.name.endsWith('.wad'));

    if (bspFiles.length !== 1) {
      this._showStatus('[!] Select exactly one .bsp file', 'warn');
      return;
    }

    try {
      const bspFile = bspFiles[0];
      const bspBuffer = await bspFile.arrayBuffer();
      const name = bspFile.name.replace(/\.bsp$/i, '');
      const wadBuffers: ArrayBuffer[] = [];
      for (const wad of wadFiles) {
        wadBuffers.push(await wad.arrayBuffer());
      }
      const sizeBytes = bspBuffer.byteLength + wadBuffers.reduce((sum, buf) => sum + buf.byteLength, 0);

      const map: StoredMap = {
        name,
        bsp: bspBuffer,
        wads: wadBuffers,
        addedAt: Date.now(),
        sizeBytes,
      };

      await saveMap(map);
      this._showStatus(`[+] map saved — ${name}`, 'green');
      await this._renderMapList();
    } catch (err: any) {
      this._showStatus(`[!] ${err.message || 'Unknown error'}`, 'warn');
    }
  }

  private _showStatus(msg: string, type: 'warn' | 'green'): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg;
    this.statusEl.className = `map-library-status ${type}`;
    // Auto-clear after 4s
    setTimeout(() => {
      if (this.statusEl && this.statusEl.textContent === msg) {
        this.statusEl.textContent = '';
        this.statusEl.className = 'map-library-status';
      }
    }, 4000);
  }

  private _serverRow(m: ServerMap): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'map-library-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'map-library-name';
    nameEl.textContent = m.name;
    const sizeEl = document.createElement('span');
    sizeEl.className = 'map-library-size';
    sizeEl.textContent = m.wadUrls.length ? `+${m.wadUrls.length} wad` : 'bsp';
    const dateEl = document.createElement('span');
    dateEl.className = 'map-library-date';
    dateEl.textContent = 'server';
    const actions = document.createElement('div');
    actions.className = 'map-library-actions';
    const flyBtn = document.createElement('button');
    flyBtn.className = 'map-library-fly-btn';
    flyBtn.textContent = 'Fly';
    flyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deps.flyServerMap?.(m.name);
    });
    actions.appendChild(flyBtn);
    row.appendChild(nameEl);
    row.appendChild(sizeEl);
    row.appendChild(dateEl);
    row.appendChild(actions);
    return row;
  }

  private async _renderMapList(): Promise<void> {
    if (!this.listContainer) return;
    try {
      const [maps, serverMaps] = await Promise.all([
        listMaps() as Promise<StoredMapMeta[]>,
        this.deps.flyServerMap ? listServerMaps().catch(() => [] as ServerMap[]) : Promise.resolve([] as ServerMap[]),
      ]);
      this.listContainer.innerHTML = '';

      if (serverMaps.length > 0) {
        const head = document.createElement('div');
        head.className = 'map-library-empty';
        head.style.cssText = 'font-weight:700;letter-spacing:.16em;text-transform:uppercase;font-size:9.5px';
        head.textContent = 'Server maps';
        this.listContainer.appendChild(head);
        for (const m of serverMaps) this.listContainer.appendChild(this._serverRow(m));
        const head2 = document.createElement('div');
        head2.className = 'map-library-empty';
        head2.style.cssText = head.style.cssText;
        head2.textContent = 'Your uploads';
        this.listContainer.appendChild(head2);
      }

      if (maps.length === 0 && serverMaps.length > 0) return;
      if (maps.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'map-library-empty';
        empty.textContent = 'No custom maps yet — drop a .bsp above.';
        this.listContainer.appendChild(empty);
        return;
      }

      for (const map of maps) {
        const row = document.createElement('div');
        row.className = 'map-library-row';

        const nameEl = document.createElement('span');
        nameEl.className = 'map-library-name';
        nameEl.textContent = map.name;

        const sizeEl = document.createElement('span');
        sizeEl.className = 'map-library-size';
        const mb = map.sizeBytes / (1024 * 1024);
        sizeEl.textContent = `${mb.toFixed(1)} MB`;

        const dateEl = document.createElement('span');
        dateEl.className = 'map-library-date';
        dateEl.textContent = new Date(map.addedAt).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
        });

        const actions = document.createElement('div');
        actions.className = 'map-library-actions';

        const flyBtn = document.createElement('button');
        flyBtn.className = 'map-library-fly-btn';
        flyBtn.textContent = 'Fly';
        flyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deps.flyMap(map.name);
        });

        const deleteBtn = document.createElement('button');
        const isPendingDelete = this.deleting.get(map.name) === true;
        deleteBtn.className = isPendingDelete
          ? 'map-library-delete-btn sure'
          : 'map-library-delete-btn';
        deleteBtn.textContent = isPendingDelete ? 'sure?' : '✕';
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._handleDeleteClick(map.name);
        });

        actions.appendChild(flyBtn);
        actions.appendChild(deleteBtn);

        row.appendChild(nameEl);
        row.appendChild(sizeEl);
        row.appendChild(dateEl);
        row.appendChild(actions);

        this.listContainer.appendChild(row);
      }
    } catch (err: any) {
      this._showStatus(`[!] ${err.message || 'Failed to load maps'}`, 'warn');
    }
  }

  private async _handleDeleteClick(name: string): Promise<void> {
    if (this.deleting.get(name)) {
      // Second click – perform delete
      try {
        await deleteMap(name);
        this.deleting.delete(name);
        this._showStatus(`[-] deleted ${name}`, 'green');
        await this._renderMapList();
      } catch (err: any) {
        this._showStatus(`[!] ${err.message || 'Delete failed'}`, 'warn');
        this.deleting.delete(name);
      }
    } else {
      // First click – set pending state
      this.deleting.set(name, true);
      await this._renderMapList();
    }
  }

  private _createDOM(): void {
    // Overlay (backdrop)
    this.overlay = document.createElement('div');
    this.overlay.className = 'map-library-overlay';

    // Panel
    this.panel = document.createElement('div');
    this.panel.className = 'map-library-panel';

    // Title row
    const titleRow = document.createElement('div');
    titleRow.className = 'map-library-title-row';

    const title = document.createElement('span');
    title.className = 'map-library-title';
    title.textContent = 'CUSTOM MAPS';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'map-library-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());

    titleRow.appendChild(title);
    titleRow.appendChild(closeBtn);

    // Drop zone
    this.dropZone = document.createElement('div');
    this.dropZone.className = 'map-library-dropzone';
    const dropText = document.createElement('span');
    dropText.className = 'map-library-dropzone-text';
    dropText.textContent =
      "Drop a CS 1.6 / Half-Life .bsp here — add its .wad files in the same drop if the map needs them (GoldSrc v30 only, not Source)";
    this.dropZone.appendChild(dropText);

    // Hidden file input
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.multiple = true;
    this.fileInput.accept = '.bsp,.wad';
    this.fileInput.style.display = 'none';

    // Status line
    this.statusEl = document.createElement('span');
    this.statusEl.className = 'map-library-status';

    // Map list container
    this.listContainer = document.createElement('div');
    this.listContainer.className = 'map-library-list';

    // Assemble panel
    this.panel.appendChild(titleRow);
    this.panel.appendChild(this.dropZone);
    this.panel.appendChild(this.statusEl);
    this.panel.appendChild(this.listContainer);
    this.panel.appendChild(this.fileInput); // keep hidden

    this.overlay.appendChild(this.panel);
    this.root.appendChild(this.overlay);
  }

  private _injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      .map-library-overlay {
        position: fixed;
        inset: 0;
        background: rgba(5,7,12,0.72);
        backdrop-filter: blur(8px);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 9999;
      }

      .map-library-panel {
        background: var(--panel);
        border: 1px solid var(--line2);
        border-radius: 12px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.55);
        width: 480px;
        max-width: calc(100% - 32px);
        max-height: calc(100% - 32px);
        overflow-y: auto;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        color: var(--fg);
      }

      .map-library-title-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .map-library-title {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.16em;
        color: var(--mut);
        text-transform: uppercase;
      }

      .map-library-close-btn {
        background: none;
        border: 1px solid var(--line);
        color: var(--fg);
        border-radius: 6px;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        cursor: pointer;
        transition: border-color 0.2s;
      }
      .map-library-close-btn:hover {
        border-color: var(--amber);
      }
      .map-library-close-btn:focus-visible {
        outline: 2px solid var(--amber);
        outline-offset: 2px;
      }

      .map-library-dropzone {
        border: 2px dashed var(--line2);
        border-radius: 8px;
        min-height: 120px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: border-color 0.2s;
        padding: 16px;
        text-align: center;
      }
      .map-library-dropzone.dragover {
        border-color: var(--amber);
      }
      .map-library-dropzone-text {
        font-size: 12px;
        color: var(--mut);
        line-height: 1.5;
      }

      .map-library-status {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .map-library-status.warn {
        color: var(--warn);
        background: rgba(238,68,68,0.1);
      }
      .map-library-status.green {
        color: var(--green);
        background: rgba(34,197,94,0.1);
      }
      .map-library-status:empty {
        display: none;
      }

      .map-library-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .map-library-empty {
        text-align: center;
        font-size: 12px;
        color: var(--mut);
        padding: 16px;
      }

      .map-library-row {
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--panel2);
        border-radius: 8px;
        padding: 10px 16px;
      }

      .map-library-name {
        font-family: 'Courier New', monospace;
        font-variant-numeric: tabular-nums;
        font-size: 13px;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .map-library-size,
      .map-library-date {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: var(--mono);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .map-library-actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .map-library-fly-btn {
        background: #ffb03b;
        color: #1a1204;
        border: none;
        border-radius: 6px;
        padding: 5px 12px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        cursor: pointer;
        transition: background 0.2s;
        text-transform: uppercase;
      }
      .map-library-fly-btn:hover {
        background: #e69d2a;
      }
      .map-library-fly-btn:focus-visible {
        outline: 2px solid var(--amber);
        outline-offset: 2px;
      }

      .map-library-delete-btn {
        background: #141a26;
        border: 1px solid var(--line);
        color: var(--fg);
        border-radius: 6px;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        cursor: pointer;
        transition: border-color 0.2s;
      }
      .map-library-delete-btn.sure {
        border-color: var(--warn);
        color: var(--warn);
        font-size: 11px;
        font-weight: 700;
        width: auto;
        padding: 0 8px;
        text-transform: uppercase;
      }
      .map-library-delete-btn:hover {
        border-color: var(--amber);
      }
      .map-library-delete-btn:focus-visible {
        outline: 2px solid var(--amber);
        outline-offset: 2px;
      }
    `;
    document.head.appendChild(style);
  }
}
