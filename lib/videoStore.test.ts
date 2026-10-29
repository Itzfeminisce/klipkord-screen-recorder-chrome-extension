import { describe, expect, it } from 'vitest';
import { createVideoStore } from './videoStore';

const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });

// Minimal in-memory OPFS: directories, files, keepExistingData writables.
class FakeFile {
  data = new Blob([]);
  async getFile() { return this.data; }
  async createWritable({ keepExistingData = false } = {}) {
    let buf = new Uint8Array(keepExistingData ? await this.data.arrayBuffer() : new ArrayBuffer(0));
    let pos = 0;
    return {
      seek: async (p: number) => { pos = p; },
      write: async (chunk: Blob) => {
        const bytes = new Uint8Array(await chunk.arrayBuffer());
        const next = new Uint8Array(Math.max(buf.length, pos + bytes.length));
        next.set(buf);
        next.set(bytes, pos);
        buf = next;
        pos += bytes.length;
      },
      close: async () => { this.data = new Blob([buf]); },
    };
  }
}
class FakeDir {
  entries = new Map<string, FakeDir | FakeFile>();
  async getDirectoryHandle(name: string, { create = false } = {}) {
    let e = this.entries.get(name);
    if (!e && create) this.entries.set(name, (e = new FakeDir()));
    if (!(e instanceof FakeDir)) throw notFound();
    return e;
  }
  async getFileHandle(name: string, { create = false } = {}) {
    let e = this.entries.get(name);
    if (!e && create) this.entries.set(name, (e = new FakeFile()));
    if (!(e instanceof FakeFile)) throw notFound();
    return e;
  }
  async removeEntry(name: string) {
    if (!this.entries.delete(name)) throw notFound();
  }
}

function setup() {
  const root = new FakeDir();
  const store = createVideoStore({
    root: async () => root as unknown as FileSystemDirectoryHandle,
    estimate: async () => ({ usage: 1234, quota: 99_999 }),
  });
  return { root, store };
}

describe('videoStore', () => {
  it('appends chunks in order and reads them back as one Blob', async () => {
    const { store } = setup();
    await store.open('r1');
    await Promise.all([
      store.append('r1', 'video', new Blob(['ab'])),
      store.append('r1', 'video', new Blob(['cd'])),
      store.append('r1', 'voice', new Blob(['xyz'])),
    ]);
    await store.append('r1', 'video', new Blob(['e']));
    const video = await store.read('r1', 'video', 'video/mp4');
    expect(await video.text()).toBe('abcde');
    expect(video.type).toBe('video/mp4');
    expect(await (await store.read('r1', 'voice')).text()).toBe('xyz');
    expect(await store.size('r1')).toBe(8);
  });

  it('reads an empty Blob and size 0 for a missing recording', async () => {
    const { store } = setup();
    expect((await store.read('none', 'video')).size).toBe(0);
    expect(await store.size('none')).toBe(0);
  });

  it('removes a recording, and removing twice is fine', async () => {
    const { store, root } = setup();
    await store.append('r2', 'video', new Blob(['data']));
    await store.remove('r2');
    await store.remove('r2');
    expect((await root.getDirectoryHandle('recordings')).entries.has('r2')).toBe(false);
    expect(await store.size('r2')).toBe(0);
  });

  it('reports storage usage', async () => {
    expect(await setup().store.usage()).toEqual({ usage: 1234, quota: 99_999 });
  });
});
