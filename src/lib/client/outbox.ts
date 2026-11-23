/**
 * Offline drafts for site work (§6 "offline drafts that sync later"): a progress
 * update made without a connection is kept on this device (IndexedDB, photos as
 * blobs) and sent automatically when the connection returns. Nothing leaves the
 * device until the user is back online and signed in.
 */
export type OutboxProgress = {
  id: string;
  kind: "progress";
  contractId: string;
  stageId: string;
  label: string;
  progress: number;
  note: string | null;
  visible: boolean;
  /** photos already uploaded before the connection dropped */
  paths: string[];
  /** photos taken offline (already shrunk to JPEG) */
  blobs: Blob[];
  createdAt: string;
};

const DB = "site-outbox";
const STORE = "items";
const EVENT = "outbox-change";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const changed = () => window.dispatchEvent(new Event(EVENT));

export async function outboxAdd(item: Omit<OutboxProgress, "id" | "createdAt" | "kind">): Promise<void> {
  await tx("readwrite", (s) => s.put({ ...item, kind: "progress", id: crypto.randomUUID(), createdAt: new Date().toISOString() }));
  changed();
}
export async function outboxList(): Promise<OutboxProgress[]> {
  if (typeof indexedDB === "undefined") return [];
  return ((await tx("readonly", (s) => s.getAll())) as OutboxProgress[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export async function outboxRemove(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
  changed();
}
export async function outboxUpdate(item: OutboxProgress): Promise<void> {
  await tx("readwrite", (s) => s.put(item));
}
export function onOutboxChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** Network failures (as opposed to a refusal from the server). */
export function isNetworkError(e: unknown): boolean {
  return !navigator.onLine || (e instanceof TypeError && /fetch|network|load failed/i.test(e.message));
}
