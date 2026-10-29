import type { Recording } from './types';

export type FolderMode = { mode: 'readwrite' };
export const RW: FolderMode = { mode: 'readwrite' };

type Perm = 'granted' | 'denied' | 'prompt';
type PermHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: FolderMode) => Promise<Perm>;
  requestPermission?: (d: FolderMode) => Promise<Perm>;
};

/** Thrown when Chrome no longer lets the extension use the folder (it asks again after a restart). */
export class FolderAccessLost extends Error {
  constructor() { super('Folder access was not granted'); this.name = 'FolderAccessLost'; }
}

/** Opens Chrome's folder picker. Needs a click; returns undefined when the picker is closed. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  const pick = (globalThis as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!pick) return undefined;
  try {
    return await pick({ mode: 'readwrite' });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') return undefined;
    throw error;
  }
}

/** Checks (and, from a click, re-asks for) write access. True when the folder can be written. */
export async function ensureAccess(handle: FileSystemDirectoryHandle, ask: boolean): Promise<boolean> {
  const h = handle as PermHandle;
  if (!h.queryPermission) return true;
  if ((await h.queryPermission(RW)) === 'granted') return true;
  if (!ask || !h.requestPermission) return false;
  return (await h.requestPermission(RW)) === 'granted';
}

/** A title that is safe as a folder name on every system. */
export function safeName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80).trim();
  return clean || 'Klipkord recording';
}

export type VideoExt = 'mp4' | 'webm';
export const videoExt = (mime: string): VideoExt => (mime.includes('webm') ? 'webm' : 'mp4');

/** `videoFormat` left out means the recording's own format. */
export interface Choice { video: boolean; videoFormat?: VideoExt; notes: boolean; captions: boolean; captionFormat: 'srt' | 'vtt' }

/** The file names the Export preview lists, in save order. */
export function fileNames(rec: Pick<Recording, 'mime'>, c: Choice): string[] {
  return [c.video && `video.${c.videoFormat ?? videoExt(rec.mime)}`, c.notes && 'notes.md', c.captions && `captions.${c.captionFormat}`].filter((x): x is string => !!x);
}

/** `Title`, or `Title (2)` when that folder already exists. */
export async function uniqueDir(root: FileSystemDirectoryHandle, title: string): Promise<string> {
  const base = safeName(title);
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} (${n})`;
    try { await root.getDirectoryHandle(name); } catch (error) {
      if ((error as { name?: string }).name === 'NotFoundError') return name;
      throw error;
    }
  }
}

export interface SavedFile { name: string; size: number }

/** Streams one file into the folder. */
export async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | string): Promise<SavedFile> {
  const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data;
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await blob.stream().pipeTo(writable);
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
  return { name, size: blob.size };
}

/** Sizes of saved files (`<folder>/<name>` paths) read back from the folder; unknown ones are left out. */
export async function readSizes(root: FileSystemDirectoryHandle, paths: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const path of paths) {
    try {
      const parts = path.split('/');
      let dir = root;
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
      out[path] = (await (await dir.getFileHandle(parts[parts.length - 1]!)).getFile()).size;
    } catch { /* the file moved or was deleted */ }
  }
  return out;
}

export interface Planned { name: string; data: () => Promise<Blob | string> }

/** Writes the planned files into a new sub-folder named after the title. Paths come back as `<sub-folder>/<name>`. */
export async function saveFiles(root: FileSystemDirectoryHandle, title: string, files: Planned[]): Promise<{ dir: string; saved: SavedFile[] }> {
  const dir = await uniqueDir(root, title);
  const handle = await root.getDirectoryHandle(dir, { create: true });
  const saved: SavedFile[] = [];
  try {
    for (const f of files) saved.push(await writeFile(handle, f.name, await f.data()));
  } catch (error) {
    await root.removeEntry(dir, { recursive: true }).catch(() => undefined); // no half-saved folder
    throw error;
  }
  return { dir, saved };
}
