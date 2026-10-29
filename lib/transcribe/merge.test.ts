import { describe, expect, it } from 'vitest';
import { appendSegment, cleanText, mergeSegments, replaceTranscript, trimOverlap, wordCount } from './merge';

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
