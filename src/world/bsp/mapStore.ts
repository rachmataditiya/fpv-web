// mapStore.ts — IndexedDB-backed storage for GoldSrc .bsp maps

export interface StoredMap {
  name: string;          // PRIMARY KEY
  bsp: ArrayBuffer;
  wads: ArrayBuffer[];   // 0..n companion WAD files
  addedAt: number;       // Date.now()
  sizeBytes: number;     // total bytes of bsp + all wads
}

export interface StoredMapMeta {
  name: string;
  addedAt: number;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Module-level connection singleton
// ---------------------------------------------------------------------------
let dbPromise: Promise<IDBDatabase> | null = null;

function getDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request: IDBOpenDBRequest = indexedDB.open('fpv_maps', 1);

    request.onerror = () => {
      console.error('IndexedDB open error', request.error);
      reject(request.error!);
    };

    request.onblocked = () => {
      // Graceful handling: log but do not reject – the upgrade will proceed
      // once other connections are closed.
      console.warn('IndexedDB open blocked. Close other tabs using this database.');
    };

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db: IDBDatabase = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains('maps')) {
        db.createObjectStore('maps', { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'name' });
      }
    };

    request.onsuccess = () => {
      const db: IDBDatabase = request.result;

      // When another tab requests a version update, close this connection
      // and invalidate the promise so a fresh connection opens next time.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        console.warn('Database version changed externally – connection closed.');
      };

      resolve(db);
    };
  });

  return dbPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upsert a map. Writes the full data into the "maps" store and metadata
 * into the "meta" store atomically.
 */
export async function saveMap(map: StoredMap): Promise<void> {
  const db = await getDatabase();
  const transaction = db.transaction(['maps', 'meta'], 'readwrite');

  const mapsStore = transaction.objectStore('maps');
  const metaStore = transaction.objectStore('meta');

  // Start both write operations
  const mapsPut = mapsStore.put(map);
  const metaPut = metaStore.put({
    name: map.name,
    addedAt: map.addedAt,
    sizeBytes: map.sizeBytes,
  } satisfies StoredMapMeta);

  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);

    // Early rejection on individual request failures
    mapsPut.onerror = () => reject(mapsPut.error);
    metaPut.onerror = () => reject(metaPut.error);
  });
}

/**
 * Return all stored maps as lightweight metadata, sorted newest‑first.
 * Only the "meta" store is touched – ArrayBuffer fields are never deserialised.
 */
export async function listMaps(): Promise<StoredMapMeta[]> {
  const db = await getDatabase();
  const transaction = db.transaction('meta', 'readonly');
  const store = transaction.objectStore('meta');
  const getAll = store.getAll();

  return new Promise<StoredMapMeta[]>((resolve, reject) => {
    getAll.onsuccess = () => {
      const allMeta = getAll.result as StoredMapMeta[];
      // Newest first
      allMeta.sort((a, b) => b.addedAt - a.addedAt);
      resolve(allMeta);
    };
    getAll.onerror = () => reject(getAll.error);
  });
}

/**
 * Load a complete map by name, including its BSP and WAD ArrayBuffers.
 * Returns `null` when no map with the given name exists.
 */
export async function loadMap(name: string): Promise<StoredMap | null> {
  const db = await getDatabase();
  const transaction = db.transaction('maps', 'readonly');
  const store = transaction.objectStore('maps');
  const getReq = store.get(name);

  return new Promise<StoredMap | null>((resolve, reject) => {
    getReq.onsuccess = () => resolve((getReq.result as StoredMap) ?? null);
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Remove a map and its metadata. Silently succeeds if the name does not exist.
 */
export async function deleteMap(name: string): Promise<void> {
  const db = await getDatabase();
  const transaction = db.transaction(['maps', 'meta'], 'readwrite');

  const mapsStore = transaction.objectStore('maps');
  const metaStore = transaction.objectStore('meta');

  const mapsDelete = mapsStore.delete(name);
  const metaDelete = metaStore.delete(name);

  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);

    mapsDelete.onerror = () => reject(mapsDelete.error);
    metaDelete.onerror = () => reject(metaDelete.error);
  });
}
