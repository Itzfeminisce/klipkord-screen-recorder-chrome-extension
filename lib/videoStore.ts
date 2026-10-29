export type Track = 'video' | 'voice';

export interface StorageUsage { usage: number; quota: number }

export interface VideoStore {
  /** Creates `recordings/<id>/`. Safe to call again. */
  open(id: string): Promise<void>;
  /** Appends to the track's open segment; a new segment starts every ROLL_MS so a crash loses at most that much. */
  append(id: string, track: Track, chunk: Blob): Promise<void>;
  /** Commits and closes the recording's open segments. A later append starts a new segment. */
  close(id: string): Promise<void>;
  /** The whole track as one Blob; empty when nothing was written. */
  read(id: string, track: Track, type?: string): Promise<Blob>;
  /** Bytes across both tracks; 0 when the recording has no files. */
  size(id: string): Promise<number>;
  remove(id: string): Promise<void>;
  usage(): Promise<StorageUsage>;
}

export interface VideoStoreDeps {
  root: () => Promise<FileSystemDirectoryHandle>;
  estimate: () => Promise<StorageEstimate>;
  now?: () => number;
}

/** How long one segment file stays open before it is committed and the next one starts. */
export const ROLL_MS = 10_000;

interface Segment { writable: FileSystemWritableFileStream; opened: number }

const isNotFound = (error: unknown) => (error as { name?: string } | null)?.name === 'NotFoundError';

export function createVideoStore({ root, estimate, now = Date.now }: VideoStoreDeps): VideoStore {
  // One writer per track at a time: appends, rolls and closes of the same track run in order.
  const queues = new Map<string, Promise<void>>();
  const open = new Map<string, Segment>();
  // Next segment number per track. Each take has a fresh id, so counting from 0 never overwrites.
  const counts = new Map<string, number>();

  async function dir(id: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    const recordings = await (await root()).getDirectoryHandle('recordings', { create });
    return recordings.getDirectoryHandle(id, { create });
  }

  function enqueue(key: string, step: () => Promise<void>): Promise<void> {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(step);
    queues.set(key, next);
    return next;
  }

  async function commit(key: string): Promise<void> {
    const segment = open.get(key);
    if (!segment) return;
    open.delete(key);
    await segment.writable.close();
  }

  // Each segment is a new file, so committing never copies what was already written.
  async function writeChunk(id: string, track: Track, chunk: Blob): Promise<void> {
    const key = `${id}/${track}`;
    let segment = open.get(key);
    if (segment && now() - segment.opened >= ROLL_MS) {
      await commit(key);
      segment = undefined;
    }
    if (!segment) {
      const n = counts.get(key) ?? 0;
      counts.set(key, n + 1);
      const file = await (await dir(id, true)).getFileHandle(`${track}.${n}`, { create: true });
      segment = { writable: await file.createWritable(), opened: now() };
      open.set(key, segment);
    }
    await segment.writable.write(chunk);
  }

  async function files(id: string, track: Track): Promise<File[]> {
    const folder = await dir(id, false);
    const get = async (name: string) => {
      try {
        return await (await folder.getFileHandle(name)).getFile();
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    };
    // A file named after the track alone is the single-file layout of earlier builds.
    const out: File[] = [];
    const legacy = await get(track);
    if (legacy) out.push(legacy);
    for (let n = 0; ; n++) {
      const part = await get(`${track}.${n}`);
      if (!part) return out;
      out.push(part);
    }
  }

  const tracks = (id: string) => (['video', 'voice'] as const).map((track) => `${id}/${track}`);

  return {
    async open(id) {
      await dir(id, true);
    },
    append(id, track, chunk) {
      return enqueue(`${id}/${track}`, () => writeChunk(id, track, chunk));
    },
    async close(id) {
      await Promise.all(tracks(id).map((key) => enqueue(key, () => commit(key))));
    },
    async read(id, track, type = '') {
      try {
        const parts = await files(id, track);
        return parts.length === 1 && !type ? parts[0]! : new Blob(parts, { type });
      } catch (error) {
        if (isNotFound(error)) return new Blob([], { type });
        throw error;
      }
    },
    async size(id) {
      let total = 0;
      for (const track of ['video', 'voice'] as const) total += (await this.read(id, track)).size;
      return total;
    },
    async remove(id) {
      // Not queued: a stuck write must never hold up a delete.
      await Promise.all(tracks(id).map(async (key) => {
        const segment = open.get(key);
        open.delete(key);
        await segment?.writable.abort().catch(() => undefined);
      }));
      try {
        const recordings = await (await root()).getDirectoryHandle('recordings');
        await recordings.removeEntry(id, { recursive: true });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
    async usage() {
      const { usage = 0, quota = 0 } = await estimate();
      return { usage, quota };
    },
  };
}

export const videoStore: VideoStore = createVideoStore({
  root: () => navigator.storage.getDirectory(),
  estimate: () => navigator.storage.estimate(),
});
