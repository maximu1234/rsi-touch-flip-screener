const DB_NAME = "rsi-touch-flip-screener";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cache")) {
        db.createObjectStore("cache");
      }
      if (!db.objectStoreNames.contains("results")) {
        db.createObjectStore("results");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(storeName, key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadCachedKlines(key, maxAgeHours, refresh) {
  if (refresh) {
    return null;
  }
  const saved = await idbGet("cache", key);
  if (!saved?.candles?.length) {
    return null;
  }
  const ageMs = Date.now() - Number(saved.fetchedAt || 0);
  const maxMs = Math.max(0, Number(maxAgeHours) || 0) * 3600 * 1000;
  if (maxMs > 0 && ageMs > maxMs) {
    return null;
  }
  return saved.candles;
}

export async function saveCachedKlines(key, candles) {
  await idbSet("cache", key, { fetchedAt: Date.now(), candles });
}

export async function loadSavedResults() {
  return (await idbGet("results", "current")) || null;
}

export async function saveSavedResults(payload) {
  await idbSet("results", "current", payload);
}

export async function clearSavedResults() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("results", "readwrite");
    tx.objectStore("results").delete("current");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
