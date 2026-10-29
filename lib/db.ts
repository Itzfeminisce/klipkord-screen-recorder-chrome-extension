import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Recording } from './types';

interface KlipkordDB extends DBSchema {
  recordings: { key: string; value: Recording; indexes: { status: string } };
  // File System Access handles survive only in IndexedDB.
  handles: { key: string; value: FileSystemDirectoryHandle };
}

export const DB_VERSION = 1;
const FOLDER_KEY = 'folder';

let dbPromise: Promise<IDBPDatabase<KlipkordDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<KlipkordDB>> {
  dbPromise ??= openDB<KlipkordDB>('klipkord', DB_VERSION, {
    // Each future version only adds stores, so earlier data is kept.
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('recordings', { keyPath: 'id' }).createIndex('status', 'status');
        db.createObjectStore('handles');
      }
    },
  });
  return dbPromise;
}

/** Test helper: close and forget the cached connection. */
export async function closeDB(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export async function putRecording(r: Recording): Promise<void> {
  await (await getDB()).put('recordings', r);
}
export type RecordingPatch = Partial<Omit<Recording, 'id'>>;

/**
 * Reads and writes one record inside a single readwrite transaction, so writers in other contexts
 * never overwrite each other's fields. Each writer patches only the fields it owns.
 * Returns the stored record, or undefined when it is gone (or the function returns null to skip).
 */
export async function updateRecording(
  id: string,
  change: RecordingPatch | ((rec: Recording) => RecordingPatch | null),
): Promise<Recording | undefined> {
  const tx = (await getDB()).transaction('recordings', 'readwrite');
  const rec = await tx.store.get(id);
  const patch = rec && (typeof change === 'function' ? change(rec) : change);
  const next = rec && patch ? { ...rec, ...patch, id } : undefined;
  if (next) await tx.store.put(next);
  await tx.done;
  return next;
}
export async function getRecording(id: string): Promise<Recording | undefined> {
  return (await getDB()).get('recordings', id);
}
/** Newest first by createdAt. */
export async function listRecordings(): Promise<Recording[]> {
  const all = await (await getDB()).getAll('recordings');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
/** Deletes the record only; remove its video with videoStore.remove(id). */
export async function deleteRecording(id: string): Promise<void> {
  await (await getDB()).delete('recordings', id);
}
/** Recordings left with status 'unfinished', newest first (shown by Recovered at start-up). */
export async function listUnfinished(): Promise<Recording[]> {
  const all = await (await getDB()).getAllFromIndex('recordings', 'status', 'unfinished');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
/**
 * Browser start-up with no offscreen document: anything still 'recording' or 'paused' was cut off,
 * so mark it 'unfinished'. A 'processing' record has no live transcript any more, so it stops waiting on one.
 */
export async function markInterrupted(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction('recordings', 'readwrite');
  const index = tx.store.index('status');
  const cut = [...(await index.getAll('recording')), ...(await index.getAll('paused'))];
  const stalled = (await index.getAll('processing')).filter((r) => r.transcriptPending);
  await Promise.all([
    ...cut.map((r) => tx.store.put({ ...r, status: 'unfinished', transcriptPending: false })),
    ...stalled.map((r) => tx.store.put({ ...r, transcriptPending: false })),
    tx.done,
  ]);
  return cut.length;
}

export async function getFolderHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return (await getDB()).get('handles', FOLDER_KEY);
}
export async function putFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await (await getDB()).put('handles', handle, FOLDER_KEY);
}
export async function clearFolderHandle(): Promise<void> {
  await (await getDB()).delete('handles', FOLDER_KEY);
}
