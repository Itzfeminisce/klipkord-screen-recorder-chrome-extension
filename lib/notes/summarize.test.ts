import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chunkLines, etaText, fitTranscript, getProgress, parseNotes, repairJson, resetNotesJobs, startNotes, transcriptLines, truncateMiddle, WAIT_MAX_MS, type JobDeps } from './summarize';
import type { Engine } from './engines';
import { defaultSettings } from './testSettings';
import type { Recording, Segment } from '../types';

const segs: Segment[] = [
  { start: 0, end: 10_000, text: 'We test checkout' },
  { start: 40_000, end: 60_000, text: 'adding two items' },
  { start: 200_000, end: 250_000, text: 'press pay and it freezes' },
];

describe('repairJson', () => {
  it('reads plain, fenced and prose-wrapped JSON', () => {
    expect(repairJson('{"a":1}')).toEqual({ a: 1 });
    expect(repairJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(repairJson('Here you go: {"a":1} Hope that helps')).toEqual({ a: 1 });
  });
  it('drops trailing commas', () => expect(repairJson('{"a":[1,2,],}')).toEqual({ a: [1, 2] }));
  it('closes a reply that was cut off', () => {
    expect(repairJson('{"summary":"ok","points":["a","b"],"chapters":[{"at":"00:40","title":"Add')).toEqual({
      summary: 'ok', points: ['a', 'b'], chapters: [{ at: '00:40', title: 'Add' }],
    });
    expect(repairJson('{"summary":"ok","points":["a",')).toEqual({ summary: 'ok', points: ['a'] });
  });
  it('throws when there is no JSON', () => expect(() => repairJson('sorry')).toThrow());
});

describe('parseNotes', () => {
  const reply = JSON.stringify({
    title: 'Checkout freezes', summary: 'Pay freezes.', points: ['one'], actions: [],
    chapters: [{ at: '00:00', title: 'Intro' }, { at: '02:00', title: 'Invented' }, { at: '03:30', title: 'The freeze' }],
    sections: { steps: [{ at: '00:45', text: 'Add items' }, { at: '09:00', text: 'Pay' }], expected: 'It works.', happened: ['It spins.'], ignored: ['x'] },
  });
  it('checks chapter times and keeps only the style\'s sections', () => {
    const n = parseNotes(reply, 'bug', segs, 260_000);
    expect(n.chapters.map((c) => c.title)).toEqual(['Intro', 'The freeze']);
    expect(n.sections).toEqual({ steps: ['45000\tAdd items', 'Pay'], expected: ['It works.'], happened: ['It spins.'] });
    expect(n.title).toBe('Checkout freezes');
  });
  it('ignores sections the style does not have', () => {
    expect(parseNotes(reply, 'general', segs, 260_000).sections).toBeUndefined();
  });
  it('throws on an empty reply', () => expect(() => parseNotes('{"summary":"","points":[]}', 'general', segs, 1)).toThrow('empty'));
});

describe('chunking', () => {
  it('splits lines under the limit and keeps every line', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i} `.padEnd(20, 'x'));
    const chunks = chunkLines(lines, 50);
    expect(chunks.every((c) => c.length <= 50)).toBe(true);
    expect(chunks.join('\n').split('\n')).toEqual(lines);
    expect(chunkLines(['a'.repeat(80)], 50)).toHaveLength(1);
  });
  it('truncates the middle', () => expect(truncateMiddle('a'.repeat(100), 20)).toContain('omitted'));

  it('condenses a transcript that does not fit a small context', async () => {
    const long: Segment[] = Array.from({ length: 40 }, (_, i) => ({ start: i * 5000, end: i * 5000 + 4000, text: 'some words here' }));
    const complete = vi.fn(async () => '[00:00] short');
    const engine: Engine = { id: 'builtin', maxChars: 200, complete };
    const onChunk = vi.fn();
    const text = await fitTranscript(engine, long, onChunk);
    const chunks = chunkLines(transcriptLines(long), 200).length;
    expect(chunks).toBeGreaterThan(1);
    expect(complete).toHaveBeenCalledTimes(chunks);
    expect(onChunk).toHaveBeenLastCalledWith(chunks, chunks);
    expect(text.length).toBeLessThanOrEqual(200);
  });
  it('sends a transcript that fits as it is', async () => {
    const complete = vi.fn();
    expect(await fitTranscript({ id: 'groq', maxChars: 1000, complete }, segs, () => undefined)).toContain('[00:40] adding two items');
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('etaText', () => {
  it('estimates once progress is far enough', () => {
    expect(etaText({ phase: 'writing', pct: 25, startedAt: 0 }, 1000)).toBeNull();
    expect(etaText({ phase: 'writing', pct: 57.5, startedAt: 0 }, 30_000)).toBe('About 30 seconds left');
  });
});

// ---- the job

const rec = (over: Partial<Recording> = {}): Recording => ({
  id: 'r1', title: 'Untitled recording', createdAt: 0, duration: 260_000, status: 'processing', mode: 'tab', quality: '1080p', mime: 'video/webm',
  bytes: 1, markers: [{ id: 'm', at: 228_000, kind: 'bug' }], notes: [], comments: [], transcript: segs, transcriptPending: false, edits: [], ...over,
});

function setup(initial: Recording, replies: string[]) {
  let stored = initial;
  const saved: Recording[] = [];
  const queue = [...replies];
  const complete = vi.fn(async () => queue.shift() ?? '{}');
  const deps: JobDeps = {
    getRecording: async () => stored,
    updateRecording: async (_id, change) => {
      const patch = typeof change === 'function' ? change(stored) : change;
      if (!patch) return stored;
      stored = { ...stored, ...patch };
      saved.push(stored);
      return stored;
    },
    transcribing: async () => true,
    getSettings: async () => defaultSettings(),
    loadKeys: async () => ({ GROQ_API_KEY: 'gsk_test' }),
    fetchFn: async () => { throw new TypeError('offline'); },
    sleep: async () => undefined,
    now: () => 0,
    globalObject: {},
  };
  // Ollama is down; Groq answers with the next scripted reply.
  deps.fetchFn = async (url) => {
    if (url.includes('11434')) throw new TypeError('offline');
    return new Response(JSON.stringify({ choices: [{ message: { content: await complete() } }] }));
  };
  return { deps, get stored() { return stored; }, saved, complete };
}

const NOTES = JSON.stringify({
  title: 'Checkout freezes', summary: 'Pay freezes.', points: [], actions: [], chapters: [{ at: '00:40', title: 'Items' }],
  sections: { steps: [{ at: '00:45', text: 'Add items' }], expected: 'Works', happened: 'Spins' },
});

beforeEach(() => resetNotesJobs());

describe('startNotes', () => {
  it('detects the style, suggests the title and writes the notes', async () => {
    const t = setup(rec(), ['{"style":"bug","title":"Checkout button freezes"}', NOTES]);
    await startNotes('r1', {}, t.deps);
    expect(t.complete).toHaveBeenCalledTimes(2);
    expect(t.stored.title).toBe('Checkout button freezes');
    expect(t.stored.status).toBe('ready');
    expect(t.stored.summary).toMatchObject({ style: 'bug', detected: 'bug', engine: 'groq', summary: 'Pay freezes.', chapters: [{ at: 40_000, title: 'Items' }] });
    expect(getProgress('r1')).toMatchObject({ phase: 'done', pct: 100, style: 'bug', suggestedTitle: 'Checkout button freezes' });
  });

  it('keeps a title the person already set', async () => {
    const t = setup(rec({ title: 'My title' }), ['{"style":"bug","title":"Other"}', NOTES]);
    await startNotes('r1', {}, t.deps);
    expect(t.stored.title).toBe('My title');
  });

  it('stops waiting when nothing is transcribing the recording', async () => {
    const t = setup(rec({ transcriptPending: true }), ['{"style":"general"}', NOTES]);
    let polls = 0;
    t.deps.sleep = async () => { polls++; };
    t.deps.transcribing = async () => polls < 3;
    await startNotes('r1', {}, t.deps);
    expect(polls).toBe(3);
    expect(t.stored.summary).toBeDefined();
  });

  it('stops waiting after WAIT_MAX_MS even while transcribing', async () => {
    const t = setup(rec({ transcriptPending: true }), ['{"style":"general"}', NOTES]);
    let clock = 0;
    t.deps.now = () => clock;
    t.deps.sleep = async (ms) => { clock += ms; };
    await startNotes('r1', {}, t.deps);
    expect(clock).toBe(WAIT_MAX_MS);
    expect(t.stored.summary).toBeDefined();
  });

  it('waits for the transcript pass to finish before writing', async () => {
    const t = setup(rec({ transcriptPending: true }), ['{"style":"general"}', NOTES]);
    let polls = 0;
    t.deps.sleep = async () => { if (++polls === 2) await t.deps.updateRecording('r1', { transcriptPending: false }); };
    await startNotes('r1', {}, t.deps);
    expect(polls).toBe(2);
    expect(t.stored.summary).toBeDefined();
  });

  it('skips detection when a default style is set', async () => {
    const t = setup(rec(), [NOTES]);
    t.deps.getSettings = async () => ({ ...defaultSettings(), defaultStyle: 'meeting' });
    await startNotes('r1', {}, t.deps);
    expect(t.complete).toHaveBeenCalledTimes(1);
    expect(t.stored.summary?.style).toBe('meeting');
  });

  it('rewrites the notes when a style is chosen, keeping the detected style and the transcript', async () => {
    const t = setup(rec(), ['{"style":"bug"}', NOTES, NOTES]);
    await startNotes('r1', {}, t.deps);
    await startNotes('r1', { style: 'update' }, t.deps);
    expect(t.stored.summary).toMatchObject({ style: 'update', detected: 'bug' });
    expect(t.stored.transcript).toEqual(segs);
  });

  it('asks again once when the reply cannot be read, then fails cleanly', async () => {
    const t = setup(rec(), ['{"style":"bug"}', 'not json', NOTES]);
    await startNotes('r1', {}, t.deps);
    expect(t.stored.summary?.summary).toBe('Pay freezes.');

    resetNotesJobs();
    const bad = setup(rec(), ['{"style":"bug"}', 'no', 'no']);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await startNotes('r1', {}, bad.deps);
    expect(getProgress('r1')?.phase).toBe('failed');
    expect(bad.stored.summary).toBeUndefined();
  });

  it('reports no engine when none can run', async () => {
    const t = setup(rec(), []);
    t.deps.loadKeys = async () => ({});
    await startNotes('r1', {}, t.deps);
    expect(getProgress('r1')?.phase).toBe('no-engine');
    expect(t.stored.status).toBe('ready');
  });

  it('does nothing while the recording is still being made', async () => {
    const t = setup(rec({ status: 'recording' }), []);
    await startNotes('r1', {}, t.deps);
    expect(t.complete).not.toHaveBeenCalled();
  });
});
