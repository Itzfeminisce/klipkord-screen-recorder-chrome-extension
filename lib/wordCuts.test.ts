import { describe, expect, it } from 'vitest';
import { editedLength, playable } from './editList';
import type { Segment } from './types';
import { deleteWords, isCut, restoreWords, units, wordCount, wordsToRanges } from './wordCuts';

const D = 20000;
const segs: Segment[] = [
  { start: 0, end: 3000, text: 'Okay this is', words: [
    { start: 0, end: 800, text: 'Okay' }, { start: 1000, end: 1600, text: 'this' }, { start: 2000, end: 3000, text: 'is' },
  ] },
  { start: 5000, end: 9000, text: 'Um, first I add', words: [
    { start: 5000, end: 5500, text: 'Um,' }, { start: 6000, end: 7000, text: 'first' }, { start: 7200, end: 8000, text: 'I' }, { start: 8200, end: 9000, text: 'add' },
  ] },
  { start: 12000, end: 15000, text: 'No words here yet' },
];
const words = units(segs);

describe('units', () => {
  it('uses word timings, and the whole line when a line has none', () => {
    expect(words).toHaveLength(8);
    expect(words[7]).toEqual({ start: 12000, end: 15000, text: 'No words here yet', line: 2 });
    expect(wordCount(words, [6, 7])).toBe(5);
  });
});

describe('wordsToRanges', () => {
  it('turns one word into its time range', () => {
    expect(wordsToRanges(words, new Set([3]))).toEqual([{ start: 5000, end: 5500 }]);
  });
  it('merges neighbours across the gaps between them, and keeps apart words that are not next to each other', () => {
    expect(wordsToRanges(words, new Set([4, 5, 6, 0]))).toEqual([{ start: 0, end: 800 }, { start: 6000, end: 9000 }]);
  });
  it('joins a sentence across lines, gap and all', () => {
    expect(wordsToRanges(words, new Set([2, 3]))).toEqual([{ start: 2000, end: 5500 }]);
  });
});

describe('deleteWords and restoreWords', () => {
  it('cuts the words so playback skips them', () => {
    const edits = deleteWords([], D, words, new Set([4, 5, 6]));
    expect(edits).toEqual([{ start: 0, end: 6000 }, { start: 9000, end: D }]);
    expect(playable(edits, D, 6500)).toEqual({ at: 9000, ended: false });
    expect(editedLength(edits, D)).toBe(D - 3000);
    expect(words.map((w) => isCut(edits, D, w))).toEqual([false, false, false, false, true, true, true, false]);
  });
  it('joins a new delete to a cut neighbour, gap included', () => {
    const once = deleteWords([], D, words, new Set([4]));
    const twice = deleteWords(once, D, words, new Set([5]));
    expect(twice).toEqual([{ start: 0, end: 6000 }, { start: 8000, end: D }]);
  });
  it('restores the words and the gaps next to kept words', () => {
    const edits = deleteWords([], D, words, new Set([4, 5]));
    expect(restoreWords(edits, D, words, 4, 5)).toEqual([]);
  });
  it('restores one word of a cut run and leaves the rest cut', () => {
    const edits = deleteWords([], D, words, new Set([4, 5, 6]));
    expect(restoreWords(edits, D, words, 5, 5)).toEqual([{ start: 0, end: 6000 }, { start: 7200, end: 8000 }, { start: 9000, end: D }]);
  });
  it('deleting nothing changes nothing', () => {
    expect(deleteWords([{ start: 0, end: 10000 }], D, words, new Set())).toEqual([{ start: 0, end: 10000 }]);
  });
});
