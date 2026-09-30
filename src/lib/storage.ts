import type { Mesh, ProjectDoc } from '../types';

/**
 * IndexedDB 工程存储：无后端，纯本地。
 * 存当前工程快照（positions/uvs/faces 全部稳定身份）。
 */

const DB_NAME = 'uv-inspector';
const STORE = 'projects';
const KEY = 'current';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode,
              fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function meshToDoc(mesh: Mesh): ProjectDoc {
  return {
    version: 1,
    savedAt: Date.now(),
    mesh: {
      name: mesh.name,
      positions: mesh.positions,
      uvs: mesh.uvs,
      faces: mesh.faces.map(f => ({
        corners: f.corners.map(c => ({ vertex: c.vertex, uv: c.uv })),
      })),
    },
  };
}

export function docToMesh(doc: ProjectDoc): Mesh {
  return {
    name: doc.mesh.name,
    positions: new Float32Array(doc.mesh.positions),
    uvs: new Float32Array(doc.mesh.uvs),
    faces: doc.mesh.faces.map(f => ({
      corners: f.corners.map(c => ({ vertex: c.vertex, uv: c.uv })),
    })),
  };
}

export async function saveProject(mesh: Mesh): Promise<void> {
  const db = await openDB();
  try { await tx(db, 'readwrite', s => s.put(meshToDoc(mesh), KEY)); }
  finally { db.close(); }
}

export async function loadProject(): Promise<Mesh | null> {
  const db = await openDB();
  try {
    const doc = await tx<ProjectDoc | undefined>(db, 'readonly', s => s.get(KEY));
    return doc ? docToMesh(doc) : null;
  } finally { db.close(); }
}

export async function clearProject(): Promise<void> {
  const db = await openDB();
  try { await tx(db, 'readwrite', s => s.delete(KEY)); }
  finally { db.close(); }
}
