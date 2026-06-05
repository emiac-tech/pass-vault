// Persists the unlocked vault across page refreshes so the master password isn't
// re-prompted on every reload. The master key is a NON-extractable CryptoKey —
// IndexedDB stores it via structured clone, so the raw key bytes are never
// exposed (you can't read them back out), preserving the zero-knowledge model.
// The unlock auto-expires after IDLE_MS of inactivity.

const DB_NAME = 'pass-vault-session';
const STORE = 'vault';
const KEY = 'current';
export const IDLE_MS = 60 * 60 * 1000; // 1 hour

interface StoredVault {
  userId: string;
  masterKey: CryptoKey;
  privateKey: CryptoKey | null;
  lastActivity: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(value: StoredVault): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbGet(): Promise<StoredVault | null> {
  const db = await openDb();
  try {
    return await new Promise<StoredVault | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as StoredVault) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function saveVaultSession(userId: string, masterKey: CryptoKey, privateKey: CryptoKey | null): Promise<void> {
  try { await idbPut({ userId, masterKey, privateKey, lastActivity: Date.now() }); } catch { /* ignore */ }
}

export async function loadVaultSession(userId: string): Promise<{ masterKey: CryptoKey; privateKey: CryptoKey | null } | null> {
  try {
    const stored = await idbGet();
    if (!stored || stored.userId !== userId) return null;
    if (Date.now() - stored.lastActivity > IDLE_MS) {
      await idbClear();
      return null;
    }
    return { masterKey: stored.masterKey, privateKey: stored.privateKey };
  } catch {
    return null;
  }
}

export async function touchVaultSession(): Promise<void> {
  try {
    const stored = await idbGet();
    if (stored) {
      stored.lastActivity = Date.now();
      await idbPut(stored);
    }
  } catch { /* ignore */ }
}

export async function clearVaultSession(): Promise<void> {
  try { await idbClear(); } catch { /* ignore */ }
}
