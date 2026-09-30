import type { ProjectRecord } from './types';

/**
 * 工程本地持久化：IndexedDB，无后端。
 * 存的是原始/当前 OBJ 文本（含活动 UV），刷新后可完全复原。
 */

const DB_NAME = 'lowpoly-uv-inspector';
const STORE = 'projects';
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => {
          // 事务结束后再关库
          t.oncomplete = () => {
            db.close();
            resolve(req.result);
          };
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      }),
  );
}

export function saveProject(rec: ProjectRecord): Promise<void> {
  return tx('readwrite', (store) =>
    store.put({ ...rec, updatedAt: Date.now() }),
  ).then(() => undefined);
}

export function listProjects(): Promise<ProjectRecord[]> {
  return tx(
    'readonly',
    (store) => store.index('updatedAt').getAll() as IDBRequest<ProjectRecord[]>,
  ).then((rows) => rows.reverse());
}

export function loadProject(id: string): Promise<ProjectRecord | undefined> {
  return tx('readonly', (store) =>
    store.get(id) as IDBRequest<ProjectRecord | undefined>,
  );
}

export function deleteProject(id: string): Promise<void> {
  return tx('readwrite', (store) => store.delete(id)).then(() => undefined);
}

export function makeProjectId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
