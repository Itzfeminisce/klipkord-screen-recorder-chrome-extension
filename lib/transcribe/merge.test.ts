import { describe, expect, it } from 'vitest';
import { appendSegment, cleanText, hasWords, mergeSegments, replaceTranscript, toSegment, trimOverlap, wordCount } from './merge';

describe('merge', () => {
  it('drops what Whisper writes for silence', () => {
    expect(cleanText(' [BLANK_AUDIO] ')).toBe('');
    expect(cleanText('(music)')).toBe('');
    expect(cleanText('...')).toBe('');
    expect(cleanText('  Hello   there. ')).toBe('Hello there.');
  });
  it('trims words repeated across a chunk boundary', () => {
    expect(trimOverlap('I press Pay, watch the', 'watch the button.')).toBe('button.');
    expect(trimOverlap('Hello there.', 'Something new')).toBe('Something new');
  });
  it('appends in time order and skips empty text', () => {
    let list = appendSegment([], { start: 0, end: 10_000, text: 'Going to checkout now' });
    list = appendSegment(list, { start: 10_000, end: 20_000, text: '[BLANK_AUDIO]' });
    list = appendSegment(list, { start: 20_000, end: 30_000, text: 'checkout now and pay' });
    expect(list).toEqual([
      { start: 0, end: 10_000, text: 'Going to checkout now' },
      { start: 20_000, end: 30_000, text: 'and pay' },
    ]);
    expect(wordCount(list)).toBe(6);
  });
  it('merges results that arrive out of order', () => {
    const out = mergeSegments([{ start: 10, end: 20, text: 'b' }, { start: 0, end: 10, text: 'a' }]);
    expect(out.map((s) => s.text)).toEqual(['a', 'b']);
  });
  it('the base pass replaces the live text unless it found nothing', () => {
    const live = [{ start: 0, end: 10, text: 'tiny' }];
    expect(replaceTranscript(live, [{ start: 0, end: 10, text: 'base' }])[0]!.text).toBe('base');
    expect(replaceTranscript(live, [])).toBe(live);
  });
});

describe('word merge', () => {
  const w = (start: number, end: number, text: string) => ({ start, end, text });
  it('places chunk words on the recording timeline, in order and inside the chunk', () => {
    const seg = toSegment(10_000, 20_000, { text: 'one two [BLANK_AUDIO]', words: [w(500, 900, ' one'), w(300, 12_000, 'two'), w(9_000, 9_500, '[BLANK_AUDIO]')] });
    expect(seg.words).toEqual([w(10_500, 10_900, 'one'), w(10_500, 20_000, 'two')]);
  });
  it('drops the words repeated across a chunk edge and keeps the rest in order', () => {
    const a = toSegment(0, 10_000, { text: 'I press Pay, watch the', words: [w(0, 400, 'I'), w(400, 800, 'press'), w(800, 1200, 'Pay,'), w(9000, 9500, 'watch'), w(9500, 9990, 'the')] });
    const b = toSegment(10_000, 20_000, { text: 'watch the button.', words: [w(0, 300, 'watch'), w(300, 600, 'the'), w(600, 1500, 'button.')] });
    const merged = mergeSegments([b, a]);
    expect(merged.map((s) => s.text)).toEqual(['I press Pay, watch the', 'button.']);
    expect(merged[1]!.words).toEqual([w(10_600, 11_500, 'button.')]);
    const all = merged.flatMap((s) => s.words!);
    expect(all.map((x) => x.start)).toEqual([...all.map((x) => x.start)].sort((x, y) => x - y));
    expect(hasWords(merged)).toBe(true);
  });
  it('a segment made only of repeated words is dropped; one without words keeps v1 merging', () => {
    const a = toSegment(0, 10_000, { text: 'the end', words: [w(0, 500, 'the'), w(500, 900, 'end')] });
    const b = toSegment(10_000, 12_000, { text: 'the end', words: [w(0, 400, 'the'), w(400, 800, 'end')] });
    expect(mergeSegments([a, b])).toHaveLength(1);
    const plain = appendSegment([], toSegment(0, 1000, 'Hello'));
    expect(plain[0]).toEqual({ start: 0, end: 1000, text: 'Hello' });
    expect(hasWords(plain)).toBe(false);
  });
});
