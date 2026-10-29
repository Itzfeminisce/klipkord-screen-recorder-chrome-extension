import { describe, expect, it, vi } from 'vitest';
import type { Recording } from '@/lib/types';
import { SAMPLE_RATE } from './chunker';
import { editedVoice, retranscribe, retranscribedPatch, toOriginalSegments, transcribeAll } from './full';

const samples = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);
// 10 s of voice; each second holds its own number so the edited track can be checked.
const voice = Float32Array.from({ length: samples(10_000) }, (_, i) => 0.1 + Math.floor(i / SAMPLE_RATE) / 100);

const rec = (over: Partial<Recording> = {}): Recording => ({
  id: 'r1', title: 'Untitled recording', createdAt: 0, duration: 10_000, status: 'ready', mode: 'tab', quality: '1080p',
  mime: 'video/webm', bytes: 0, markers: [], notes: [], comments: [], transcriptPending: false,
  transcript: [{ start: 0, end: 10_000, text: 'old live text' }], transcriptModel: 'live',
  edits: [{ start: 0, end: 2_000 }, { start: 4_000, end: 10_000 }],
  ...over,
});

describe('full pass', () => {
  it('edited voice keeps only the kept parts, end to end', () => {
    const out = editedVoice(voice, rec().edits, 10_000);
    expect(out.length).toBe(samples(8_000));
    expect(out[samples(2_000)]).toBeCloseTo(0.14);
    expect(editedVoice(voice, [], 10_000).length).toBe(voice.length);
  });
  it('maps edited times back to original times; an end on a cut edge stays before the cut', () => {
    const segs = toOriginalSegments([{ start: 1_500, end: 2_000, text: 'a', words: [{ start: 1_500, end: 2_000, text: 'a' }] },
      { start: 2_000, end: 2_600, text: 'b' }], rec().edits, 10_000);
    expect(segs).toEqual([{ start: 1_500, end: 2_000, text: 'a', words: [{ start: 1_500, end: 2_000, text: 'a' }] },
      { start: 4_000, end: 4_600, text: 'b' }]);
  });
  it('re-transcribe keeps edits: times follow the original video and the patch touches only the transcript', async () => {
    const r = rec();
    let n = 0;
    const transcribe = vi.fn(async () => ({ text: `w${++n}`, words: [{ start: 500, end: 900, text: `w${n}` }] }));
    const segs = await retranscribe(r, { readVoice: async () => voice, transcribe, chunkMs: 4_000 });
    // Edited chunks: 0–4 s, 4–8 s (8 s edited); the second starts at edited 4 s = original 6 s.
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(segs!.map((s) => [s.start, s.words![0]!.start])).toEqual([[0, 500], [6_000, 6_500]]);
    const patch = retranscribedPatch(segs!);
    expect(patch).toEqual({ transcript: segs, transcriptPending: false, transcriptModel: 'full' });
    expect('edits' in patch).toBe(false);
    expect(r.edits).toEqual([{ start: 0, end: 2_000 }, { start: 4_000, end: 10_000 }]);
  });
  it('stopping part way gives nothing, so the old transcript stays; silent chunks are skipped', async () => {
    let stop = false;
    const transcribe = vi.fn(async () => {
      stop = true;
      return { text: 'x', words: [] };
    });
    await expect(transcribeAll(voice, { transcribe, stopped: () => stop, chunkMs: 4_000 })).resolves.toBeNull();
    expect(transcribe).toHaveBeenCalledTimes(1);
    const quiet = vi.fn(async () => ({ text: 'ghost' }));
    await expect(transcribeAll(new Float32Array(samples(3_000)), { transcribe: quiet })).resolves.toEqual([]);
    expect(quiet).not.toHaveBeenCalled();
  });
});
