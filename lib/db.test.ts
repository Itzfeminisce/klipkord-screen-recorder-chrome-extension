import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFolderHandle, closeDB, deleteRecording, getFolderHandle, getRecording, listRecordings, listUnfinished,
  markInterrupted, putFolderHandle, putRecording,
} from './db';
import type { Recording } from './types';

const rec = (id: string, createdAt: number, status: Recording['status'] = 'ready'): Recording => ({
  id, title: id, createdAt, duration: 1000, status, mode: 'tab', quality: '1080p', mime: 'video/mp4', bytes: 10,
  markers: [{ id: 'm1', at: 500, kind: 'bug' }], notes: [], comments: [], transcript: [], transcriptPending: false, edits: [],
});

describe('db', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
  });

  it('round-trips a recording and lists newest first', async () => {
    await putRecording(rec('a', 1));
    await putRecording(rec('b', 2));
    expect(await getRecording('a')).toEqual(rec('a', 1));
    expect((await listRecordings()).map((r) => r.id)).toEqual(['b', 'a']);
    await deleteRecording('a');
    expect(await getRecording('a')).toBeUndefined();
  });

  it('marks cut-off recordings unfinished and lists them', async () => {
    await putRecording(rec('live', 1, 'recording'));
    await putRecording(rec('held', 2, 'paused'));
    await putRecording(rec('done', 3, 'ready'));
    expect(await listUnfinished()).toEqual([]);
    expect(await markInterrupted()).toBe(2);
    expect((await listUnfinished()).map((r) => r.id)).toEqual(['held', 'live']);
    expect((await getRecording('done'))?.status).toBe('ready');
  });

  it('stores and clears the folder handle', async () => {
    const handle = { name: 'Videos', kind: 'directory' } as unknown as FileSystemDirectoryHandle;
    expect(await getFolderHandle()).toBeUndefined();
    await putFolderHandle(handle);
    expect((await getFolderHandle())?.name).toBe('Videos');
    await clearFolderHandle();
    expect(await getFolderHandle()).toBeUndefined();
  });
});
