export type Track = 'video' | 'voice';

export interface StorageUsage { usage: number; quota: number }

export interface VideoStore {
  /** Creates `recordings/<id>/`. Safe to call again. */
  open(id: string): Promise<void>;
  append(id: string, track: Track, chunk: Blob): Promise<void>;
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
}

const isNotFound = (error: unknown) => (error as { name?: string } | null)?.name === 'NotFoundError';

export function createVideoStore({ root, estimate }: VideoStoreDeps): VideoStore {
  // One writer per file at a time: appends to the same track run in order.
  const queues = new Map<string, Promise<void>>();

  async function dir(id: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    const recordings = await (await root()).getDirectoryHandle('recordings', { create });
    return recordings.getDirectoryHandle(id, { create });
  }

  async function writeChunk(id: string, track: Track, chunk: Blob): Promise<void> {
    const file = await (await dir(id, true)).getFileHandle(track, { create: true });
    const end = (await file.getFile()).size;
    const writable = await file.createWritable({ keepExistingData: true });
    try {
      await writable.seek(end);
      await writable.write(chunk);
    } finally {
      await writable.close();
    }
  }

  return {
    async open(id) {
      await dir(id, true);
    },
    append(id, track, chunk) {
      const key = `${id}/${track}`;
      const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => writeChunk(id, track, chunk));
      queues.set(key, next);
      return next;
    },
    async read(id, track, type = '') {
      try {
        const file = await (await (await dir(id, false)).getFileHandle(track)).getFile();
        return type ? new Blob([file], { type }) : file;
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
