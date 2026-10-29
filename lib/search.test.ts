import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { backfillSearchIndex, closeDB, deleteRecording, getDB, listSearchEntries, putRecording, updateRecording } from './db';
import {
  MAX_HITS_PER_RECORDING, SNIPPET_AFTER, SNIPPET_BEFORE, createIndex, docsOf, fold, indexDocs, indexRecording, removeRecording, search, snippetOf, tokenize,
} from './search';
import type { Recording } from './types';

const rec = (id: string, over: Partial<Recording> = {}): Recording => ({
  id, title: id, createdAt: 1, duration: 60000, status: 'ready', mode: 'tab', quality: '720p', mime: 'video/mp4', bytes: 1,
  markers: [], notes: [], comments: [], transcript: [], transcriptPending: false, edits: [], ...over,
});

describe('fold and tokenize', () => {
  it('folds case and accents', () => {
    expect(tokenize('Café, RÉSUMÉ naïve!')).toEqual(['cafe', 'resume', 'naive']);
  });
  it('maps folded offsets back to the source text', () => {
    const f = fold('Ça va');
    expect(f.text).toBe('ca va');
    expect(f.map[0]).toBe(0);
    expect(f.map[3]).toBe(3);
  });
});

describe('index and query', () => {
  const checkout = rec('a', {
    title: 'Checkout button freezes on Safari',
    transcript: [
      { start: 1000, end: 2000, text: 'Hello everyone' },
      { start: 221000, end: 225000, text: 'and when I press Pay here in Safari, the button keeps spinning' },
    ],
    notes: [{ id: 'n', at: 5000, text: 'Check the Café flow' }],
    comments: [{ id: 'c', at: 9000, text: 'Looks like a timeout', resolved: false, createdAt: 1 }],
    summary: { style: 'bug', detected: 'bug', engine: 'x', summary: 'Pay spins in Safari.', points: [], actions: ['Fix the spinner'], chapters: [] },
  });

  it('finds a transcript word with its time, label and highlighted range', () => {
    const idx = createIndex();
    indexRecording(idx, checkout);
    const hit = search(idx, 'spinning').find((h) => h.field === 'transcript')!;
    expect(hit.recordingId).toBe('a');
    expect(hit.at).toBe(221000);
    expect(hit.snippet.slice(...hit.match)).toBe('spinning');
  });
  it('searches titles, notes and comments, folding case and accents', () => {
    const idx = createIndex();
    indexRecording(idx, checkout);
    expect(search(idx, 'SAFARI').map((h) => h.field)).toEqual(['title', 'transcript', 'notes']);
    const cafe = search(idx, 'cafe');
    expect(cafe).toHaveLength(1);
    expect(cafe[0]).toMatchObject({ field: 'notes', at: 5000 });
    expect(cafe[0]!.snippet.slice(...cafe[0]!.match)).toBe('Café');
    expect(search(idx, 'timeout')[0]).toMatchObject({ field: 'notes', at: 9000 });
  });
  it('needs every word and lets the last one be a prefix', () => {
    const idx = createIndex();
    indexRecording(idx, checkout);
    expect(search(idx, 'press safari')).toHaveLength(1);
    expect(search(idx, 'press chrome')).toEqual([]);
    expect(search(idx, 'spinn')).toHaveLength(2);
    expect(search(idx, '   ')).toEqual([]);
  });
  it('groups hits by recording in the given order', () => {
    const idx = createIndex();
    indexRecording(idx, rec('a', { title: 'safari one' }));
    indexRecording(idx, rec('b', { title: 'safari two' }));
    expect(search(idx, 'safari', ['b', 'a']).map((h) => h.recordingId)).toEqual(['b', 'a']);
  });
  it('caps hits per recording', () => {
    const idx = createIndex();
    const transcript = Array.from({ length: 20 }, (_, i) => ({ start: i, end: i + 1, text: 'safari again' }));
    indexRecording(idx, rec('a', { transcript }));
    expect(search(idx, 'safari')).toHaveLength(MAX_HITS_PER_RECORDING);
  });
  it('indexes only ready recordings', () => {
    expect(docsOf(rec('a', { status: 'recording' }))).toEqual([]);
  });
});

describe('updates and deletes', () => {
  it('replaces old words when a recording changes', () => {
    const idx = createIndex();
    indexRecording(idx, rec('a', { title: 'alpha' }));
    indexRecording(idx, rec('a', { title: 'beta' }));
    expect(search(idx, 'alpha')).toEqual([]);
    expect(search(idx, 'beta')).toHaveLength(1);
    expect(idx.words.has('alpha')).toBe(false);
  });
  it('keeps shared words for other recordings after a delete', () => {
    const idx = createIndex();
    indexRecording(idx, rec('a', { title: 'shared word' }));
    indexRecording(idx, rec('b', { title: 'shared thing' }));
    removeRecording(idx, 'a');
    expect(search(idx, 'shared').map((h) => h.recordingId)).toEqual(['b']);
    removeRecording(idx, 'b');
    expect(idx.words.size).toBe(0);
    expect(idx.docs.size).toBe(0);
  });
});

describe('snippet bounds', () => {
  const long = `${'word '.repeat(60)}needle ${'tail '.repeat(60)}`;
  it('stays inside the window, ellipsised, with the match inside it', () => {
    const start = long.indexOf('needle');
    const s = snippetOf(long, [start, start + 6]);
    expect(s.snippet.length).toBeLessThanOrEqual(SNIPPET_BEFORE + 6 + SNIPPET_AFTER + 2);
    expect(s.snippet.startsWith('…') && s.snippet.endsWith('…')).toBe(true);
    expect(s.snippet.slice(...s.match)).toBe('needle');
  });
  it('keeps short text whole', () => {
    expect(snippetOf('a needle b', [2, 8])).toEqual({ snippet: 'a needle b', match: [2, 8] });
  });
});

describe('stored index', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
  });
  const load = async () => {
    const idx = createIndex();
    (await listSearchEntries()).forEach((e) => indexDocs(idx, e.id, e.docs));
    return idx;
  };

  it('follows put, update and delete', async () => {
    await putRecording(rec('a', { title: 'first title' }));
    expect(search(await load(), 'first')).toHaveLength(1);
    await updateRecording('a', { title: 'second title', transcript: [{ start: 3000, end: 4000, text: 'spoken words' }] });
    const idx = await load();
    expect(search(idx, 'first')).toEqual([]);
    expect(search(idx, 'spoken')[0]).toMatchObject({ recordingId: 'a', at: 3000 });
    await deleteRecording('a');
    expect(await listSearchEntries()).toEqual([]);
  });
  it('indexes older recordings once and reports progress', async () => {
    await putRecording(rec('a', { createdAt: 1 }));
    await putRecording(rec('b', { createdAt: 2 }));
    await (await getDB()).clear('searchIndex');
    const seen: Array<[number, number]> = [];
    await backfillSearchIndex((d, t) => seen.push([d, t]));
    expect(seen).toEqual([[0, 2], [1, 2], [2, 2]]);
    expect(await listSearchEntries()).toHaveLength(2);
    seen.length = 0;
    await backfillSearchIndex((d, t) => seen.push([d, t]));
    expect(seen).toEqual([[2, 2]]);
  });
});
