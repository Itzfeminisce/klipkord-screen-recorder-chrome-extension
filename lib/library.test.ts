import { describe, expect, it } from 'vitest';
import { buildCaptions, captionCues } from './captions';
import { fileNames, safeName, saveFiles } from './folder';
import { estimateVideoBytes, filterByStyle, groupByDay, hasSavedVideo, splitDeletable, totalBytes } from './library';
import { buildMarkdown } from './markdown';
import type { Recording, Segment } from './types';

const segs: Segment[] = [
  { start: 0, end: 4000, text: 'Hello' },
  { start: 5000, end: 9000, text: 'Cut me' },
  { start: 9500, end: 13000, text: 'Straddles' },
  { start: 20000, end: 22000, text: 'End' },
];
// keep 0-5s and 10-30s: the 5-10s part is cut
const edits = [{ start: 0, end: 5000 }, { start: 10000, end: 30000 }];

const rec = (over: Partial<Recording> = {}): Recording => ({
  id: 'r', title: 'Checkout: freezes?', createdAt: 0, duration: 30000, status: 'ready', mode: 'tab', quality: '720p',
  mime: 'video/mp4', bytes: 3000, markers: [], notes: [], comments: [], transcript: segs, transcriptPending: false, edits: [], ...over,
});

describe('captions', () => {
  it('keeps every line when nothing is cut', () => {
    expect(captionCues(segs, [], 30000)).toHaveLength(4);
  });
  it('drops cut lines, clips straddlers and moves times to the edited video', () => {
    const cues = captionCues(segs, edits, 30000);
    expect(cues.map((c) => c.text)).toEqual(['Hello', 'Straddles', 'End']);
    expect(cues[1]).toEqual({ start: 5000, end: 8000, text: 'Straddles' });
    expect(cues[2]).toEqual({ start: 15000, end: 17000, text: 'End' });
  });
  it('writes SRT with commas and numbering', () => {
    const srt = buildCaptions(segs, edits, 30000, 'srt');
    expect(srt.startsWith('1\n00:00:00,000 --> 00:00:04,000\nHello\n\n2\n00:00:05,000 --> 00:00:08,000\nStraddles\n')).toBe(true);
  });
  it('writes VTT with a header and dots', () => {
    const vtt = buildCaptions(segs, edits, 30000, 'vtt');
    expect(vtt.startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nHello\n')).toBe(true);
    expect(vtt).toContain('00:00:15.000 --> 00:00:17.000');
  });
  it('formats hours', () => {
    expect(buildCaptions([{ start: 3723000, end: 3724500, text: 'x' }], [], 4000000, 'srt')).toContain('01:02:03,000 --> 01:02:04,500');
  });
});

describe('markdown', () => {
  const notes = (style: 'bug' | 'meeting' | 'howto') => ({
    style, detected: style, engine: 'builtin', summary: 'It freezes.', points: ['P1'], actions: ['A1'],
    chapters: [{ at: 12000, title: 'Intro' }],
    sections: { steps: ['1000\tOpen cart', 'Click pay'], expected: ['Pays'], happened: ['Freezes'], decisions: ['Ship it'] },
  });
  it('bug report: steps, expected, what happened, chapters, edited transcript', () => {
    const md = buildMarkdown(rec({ summary: notes('bug'), edits }));
    expect(md).toContain('# Checkout: freezes?');
    expect(md).toContain('## Steps to reproduce\n\n1. Open cart (00:01)\n2. Click pay');
    expect(md).toContain('## Expected\n\n- Pays');
    expect(md).toContain('## What happened\n\n- Freezes');
    expect(md).toContain('- 00:07 Intro');
    expect(md).toContain('00:15 End');
    expect(md).not.toContain('Cut me');
    expect(md).not.toContain('Key points');
  });
  it('meeting: decisions, points and actions', () => {
    const md = buildMarkdown(rec({ summary: notes('meeting') }));
    expect(md).toContain('## Decisions');
    expect(md).toContain('## Key points');
    expect(md).toContain('## Action items');
  });
  it('how-to: steps only', () => {
    const md = buildMarkdown(rec({ summary: notes('howto') }));
    expect(md).toContain('## Steps');
    expect(md).not.toContain('Decisions');
  });
  it('works before notes exist', () => {
    expect(buildMarkdown(rec())).toContain('## Transcript');
  });
});

describe('file names', () => {
  it('lists the chosen files in order', () => {
    expect(fileNames(rec(), { video: true, notes: true, captions: true, captionFormat: 'srt' })).toEqual(['video.mp4', 'notes.md', 'captions.srt']);
    expect(fileNames(rec({ mime: 'video/webm' }), { video: true, notes: false, captions: true, captionFormat: 'vtt' })).toEqual(['video.webm', 'captions.vtt']);
  });
  it('makes a safe folder name', () => {
    expect(safeName('Checkout: freezes/on <Safari>?')).toBe('Checkout freezes on Safari');
    expect(safeName('  ...  ')).toBe('Klipkord recording');
  });
});

interface FakeDir { files: Map<string, string>; dirs: Map<string, FakeDir>; getDirectoryHandle(n: string, o?: { create?: boolean }): Promise<FakeDir>; getFileHandle(n: string): Promise<unknown> }
function fakeDir(existing: string[] = []): FakeDir {
  const dirs = new Map<string, FakeDir>(existing.map((n) => [n, fakeDir()]));
  const files = new Map<string, string>();
  return {
    files, dirs,
    async getDirectoryHandle(name: string, o?: { create?: boolean }) {
      if (!dirs.has(name)) {
        if (!o?.create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' });
        dirs.set(name, fakeDir());
      }
      return dirs.get(name)!;
    },
    async getFileHandle(name: string) {
      return { async createWritable() {
        const chunks: Uint8Array[] = [];
        return new WritableStream<Uint8Array>({ write(c) { chunks.push(c); }, close() { files.set(name, new TextDecoder().decode(Buffer.concat(chunks))); } });
      } };
    },
  };
}

describe('save', () => {
  it('writes each file into a sub-folder and reports sizes', async () => {
    const root = fakeDir();
    const out = await saveFiles(root as never, 'Bug: one', [
      { name: 'notes.md', data: async () => '# hi' },
      { name: 'video.mp4', data: async () => new Blob(['abc']) },
    ]);
    expect(out.dir).toBe('Bug one');
    expect(out.saved).toEqual([{ name: 'notes.md', size: 4 }, { name: 'video.mp4', size: 3 }]);
    expect(root.dirs.get('Bug one')!.files.get('notes.md')).toBe('# hi');
  });
  it('never overwrites an earlier save', async () => {
    const root = fakeDir(['Bug one']);
    expect((await saveFiles(root as never, 'Bug one', [])).dir).toBe('Bug one (2)');
  });
});

describe('library', () => {
  const day = 86400000;
  const now = new Date(2026, 9, 29, 15, 0).getTime();
  it('groups newest first by day', () => {
    const list = [rec({ id: 'old', createdAt: now - 40 * day }), rec({ id: 'wk', createdAt: now - 2 * day }), rec({ id: 'now', createdAt: now - 3600000 })];
    const groups = groupByDay(list, now, 'en-US');
    expect(groups.map((g) => g.label)).toEqual(['Today', 'This week', 'September 2026']);
    expect(groups.map((g) => g.items[0]!.id)).toEqual(['now', 'wk', 'old']);
  });
  it('filters by style', () => {
    const n = (style: 'bug' | 'howto') => ({ style, detected: style, engine: '', summary: '', points: [], actions: [], chapters: [] });
    const list = [rec({ id: 'a', summary: n('bug') }), rec({ id: 'b', summary: n('howto') }), rec({ id: 'c' })];
    expect(filterByStyle(list, 'all')).toHaveLength(3);
    expect(filterByStyle(list, 'bug').map((r) => r.id)).toEqual(['a']);
  });
  it('estimates the edited size', () => {
    expect(estimateVideoBytes(rec())).toBe(3000);
    expect(estimateVideoBytes(rec({ edits: [{ start: 0, end: 15000 }] }))).toBe(1500);
  });
});

describe('storage selection', () => {
  const saved = (id: string, files: string[]) => rec({ id, savedTo: { folder: 'F', at: 1, files } });
  it('offers only videos already saved to the folder', () => {
    const list = [saved('a', ['T/video.mp4', 'T/notes.md']), saved('b', ['T/notes.md']), rec({ id: 'c' }), saved('d', ['T/video.webm']), saved('gone', ['T/video.mp4'])];
    const sizes = { a: 100, b: 50, c: 30, d: 20, gone: 0 };
    const { saved: s, unsaved } = splitDeletable(list, sizes);
    expect(s.map((x) => x.rec.id)).toEqual(['a', 'd']);
    expect(totalBytes(s)).toBe(120);
    expect(unsaved.map((x) => x.rec.id)).toEqual(['b', 'c']);
    expect(hasSavedVideo(saved('x', ['video.mp4']))).toBe(true);
  });
});

describe('print page', () => {
  it('escapes text and keeps the structure', async () => {
    const { markdownToHtml } = await import('./markdown');
    const html = markdownToHtml('# A <b>\n\n## Steps\n\n1. one\n2. two\n\n- x', 'A');
    expect(html).toContain('<h1>A &lt;b&gt;</h1>');
    expect(html).toContain('<ol><li>one</li><li>two</li></ol>');
    expect(html).toContain('<ul><li>x</li></ul>');
  });
});
