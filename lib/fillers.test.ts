import { describe, expect, it } from 'vitest';
import { findFillers } from './fillers';
import type { Segment } from './types';

function seg(...texts: string[]): Segment {
  const words = texts.map((text, i) => ({ start: i * 500, end: i * 500 + 400, text }));
  return { start: 0, end: words.length * 500, text: texts.join(' '), words };
}

describe('findFillers', () => {
  it('finds um, uh and er in any case, with punctuation', () => {
    const hits = findFillers([seg('So', 'Um,', 'the', 'uh', 'plan', 'er.')]);
    expect(hits.map((h) => h.text)).toEqual(['um', 'uh', 'er']);
    expect(hits[0]).toEqual({ start: 500, end: 900, text: 'um' });
  });
  it('joins "you know" into one range', () => {
    expect(findFillers([seg('and', 'you', 'know', 'it', 'works')])).toEqual([{ start: 500, end: 1400, text: 'you know' }]);
  });
  it('takes "like" only at the start of a phrase', () => {
    expect(findFillers([seg('I', 'like', 'it')])).toEqual([]);
    expect(findFillers([seg('Like', 'this', 'one')])).toHaveLength(1);
    expect(findFillers([seg('Done.', 'Like', 'so')])).toHaveLength(1);
  });
  it('skips segments without words and words like "summer"', () => {
    expect(findFillers([{ start: 0, end: 1, text: 'um' }, seg('summer', 'ermine')])).toEqual([]);
  });
});
