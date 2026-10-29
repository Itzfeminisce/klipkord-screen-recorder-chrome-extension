import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDB, getRecording, putRecording } from './db';
import { addMarker, addNote, markerTime, noteStart, undoMarker } from './markers';
import { IDLE, clockPause, clockResume, clockStart, type RecorderState } from './recorder';
import type { Recording } from './types';

const live = (clock: RecorderState['clock'], status: RecorderState['status'] = 'recording'): RecorderState => ({ ...IDLE, status, recordingId: 'r', clock });
const rec = (): Recording => ({
  id: 'r', title: 't', createdAt: 0, duration: 0, status: 'recording', mode: 'tab', quality: '1080p', mime: 'video/webm', bytes: 0,
  markers: [], notes: [], comments: [], transcript: [], transcriptPending: false, edits: [],
});

describe('markers', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await putRecording(rec());
  });

  it('marker time leaves pauses out', () => {
    let c = clockStart(1000);
    c = clockPause(c, 11_000); // 10 s recorded
    c = clockResume(c, 71_000); // 60 s paused
    expect(markerTime(live(c), 76_000)).toBe(15_000);
    expect(markerTime(live(clockPause(c, 76_000), 'paused'), 500_000)).toBe(15_000);
    expect(markerTime(IDLE, 1)).toBeNull();
  });

  it('saves markers in time order and undo removes only that one', async () => {
    const a = await addMarker('r', 5000, 'bug');
    const b = await addMarker('r', 2000, 'step');
    expect((await getRecording('r'))!.markers.map((m) => m.kind)).toEqual(['step', 'bug']);
    await undoMarker('r', a!);
    expect((await getRecording('r'))!.markers.map((m) => m.id)).toEqual([b]);
    expect(await addMarker('gone', 1, 'step')).toBeNull();
  });

  it('a note keeps the time typing started', async () => {
    let started = noteStart(null, '', 4000);
    expect(started).toBeNull();
    started = noteStart(started, 'c', 4000);
    started = noteStart(started, 'check', 9000);
    expect(started).toBe(4000);
    expect(noteStart(started, '  ', 9500)).toBeNull();
    expect(await addNote('r', started!, '  check the button ')).toBe(true);
    expect((await getRecording('r'))!.notes).toMatchObject([{ at: 4000, text: 'check the button' }]);
    expect(await addNote('r', 1, '   ')).toBe(false);
  });
});
