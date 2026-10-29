import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFolderHandle, closeDB, deleteRecording, getFolderHandle, getRecording, listRecordings, listUnfinished,
  markInterrupted, putFolderHandle, putRecording, updateRecording,
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

  it('stops processing records waiting on a transcript nobody is writing', async () => {
    await putRecording({ ...rec('p', 1, 'processing'), transcriptPending: true });
    expect(await markInterrupted()).toBe(0);
    expect(await getRecording('p')).toMatchObject({ status: 'processing', transcriptPending: false });
  });

  it('patches a record and skips a missing one', async () => {
    await putRecording(rec('a', 1));
    expect(await updateRecording('a', { savedTo: { folder: 'F', at: 1, files: [] } })).toMatchObject({ id: 'a', savedTo: { folder: 'F' } });
    expect(await updateRecording('a', () => null)).toBeUndefined();
    expect(await updateRecording('gone', { title: 'x' })).toBeUndefined();
    expect(await getRecording('gone')).toBeUndefined();
  });

  it('keeps every field when writers patch the same record at once', async () => {
    await putRecording(rec('a', 1, 'recording'));
    await Promise.all([
      updateRecording('a', { duration: 5000, bytes: 99 }),
      updateRecording('a', (r) => ({ markers: [...r.markers, { id: 'm2', at: 900, kind: 'step' }] })),
      updateRecording('a', (r) => ({ notes: [...r.notes, { id: 'n1', at: 100, text: 'hi' }] })),
      updateRecording('a', (r) => ({ markers: [...r.markers, { id: 'm3', at: 950, kind: 'bug' }] })),
      updateRecording('a', { savedTo: { folder: 'F', at: 2, files: ['x'] } }),
    ]);
    const out = await getRecording('a');
    expect(out).toMatchObject({ duration: 5000, bytes: 99, savedTo: { folder: 'F' }, notes: [{ id: 'n1' }] });
    expect(out?.markers.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
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
