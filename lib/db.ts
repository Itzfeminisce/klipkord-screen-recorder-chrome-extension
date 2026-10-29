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
/** Browser start-up: anything still 'recording' or 'paused' was cut off, so mark it 'unfinished'. */
export async function markInterrupted(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction('recordings', 'readwrite');
  const index = tx.store.index('status');
  const cut = [...(await index.getAll('recording')), ...(await index.getAll('paused'))];
  await Promise.all([...cut.map((r) => tx.store.put({ ...r, status: 'unfinished' })), tx.done]);
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
