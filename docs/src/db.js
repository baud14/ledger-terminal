// Minimal promise-wrapped IndexedDB. Stores: holdings, snapshots.

const DB_NAME = "ledger-terminal";
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("holdings"))
          db.createObjectStore("holdings", { keyPath: "key" });
        if (!db.objectStoreNames.contains("snapshots"))
          db.createObjectStore("snapshots", { keyPath: "date" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result.__value !== undefined ? result.__value : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function getAll(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getOne(store, key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export const put = (store, value) => tx(store, "readwrite", os => ({ __value: os.put(value) }));
export const del = (store, key) => tx(store, "readwrite", os => ({ __value: os.delete(key) }));
export const clear = (store) => tx(store, "readwrite", os => ({ __value: os.clear() }));
