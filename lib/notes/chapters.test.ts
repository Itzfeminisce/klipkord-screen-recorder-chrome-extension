import { describe, expect, it } from 'vitest';
import { checkChapters, checkTime, checkTimedLines, decodeTimed, encodeTimed, parseClock } from './chapters';
import type { Segment } from '../types';

const segs: Segment[] = [
  { start: 0, end: 10_000, text: 'hi' },
  { start: 40_000, end: 60_000, text: 'adding items' },
  { start: 200_000, end: 250_000, text: 'checkout' },
];

describe('parseClock', () => {
  it('reads mm:ss, h:mm:ss, brackets and seconds', () => {
    expect(parseClock('03:48')).toBe(228_000);
    expect(parseClock('[1:02:03]')).toBe(3_723_000);
    expect(parseClock(42)).toBe(42_000);
    expect(parseClock('soon')).toBeNull();
    expect(parseClock(-1)).toBeNull();
  });
});

describe('checkTime', () => {
  it('keeps a time inside speech and snaps one just outside it', () => {
    expect(checkTime(45_000, segs, 260_000)).toBe(45_000);
    expect(checkTime(35_000, segs, 260_000)).toBe(40_000);
  });
  it('rejects a time far from any speech or past the end', () => {
    expect(checkTime(120_000, segs, 260_000)).toBeNull();
    expect(checkTime(900_000, segs, 260_000)).toBeNull();
    expect(checkTime(5_000, [], 260_000)).toBeNull();
  });
});

describe('checkChapters', () => {
  it('drops unbacked, untitled and crowded chapters, and sorts the rest', () => {
    const out = checkChapters([
      { at: '03:30', title: ' Checkout ' },
      { at: '00:00', title: 'Intro' },
      { at: '00:02', title: 'Too close' },
      { at: '02:00', title: 'Made up' },
      { at: '00:45', title: '' },
      { at: 'x', title: 'Bad time' },
      'nope',
    ], segs, 260_000);
    expect(out).toEqual([{ at: 0, title: 'Intro' }, { at: 210_000, title: 'Checkout' }]);
  });
  it('returns nothing for a non-array', () => expect(checkChapters(null, segs, 1)).toEqual([]));
});

describe('timed lines', () => {
  it('round-trips and keeps the text when the time is not backed', () => {
    expect(decodeTimed(encodeTimed(42_000, 'Add items'))).toEqual({ at: 42_000, text: 'Add items' });
    expect(decodeTimed('plain')).toEqual({ text: 'plain' });
    expect(checkTimedLines([{ at: '00:45', text: 'Add' }, { at: '02:00', text: 'Pay' }, 'Done'], segs, 260_000))
      .toEqual([encodeTimed(45_000, 'Add'), 'Pay', 'Done']);
  });
});
