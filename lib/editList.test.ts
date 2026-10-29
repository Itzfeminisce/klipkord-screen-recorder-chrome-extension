import { describe as group, expect, it } from 'vitest';
import {
  MIN_KEPT_MS, cut, describe, editedLength, keptRanges, normalize, playable, rangeAtMicros, restore, setEnd, setStart, toEdited, toOriginal,
} from './editList';

const D = 252000; // 4:12

group('keptRanges and normalize', () => {
  it('treats an empty list as the whole video', () => {
    expect(keptRanges([], D)).toEqual([{ start: 0, end: D }]);
    expect(keptRanges([], 0)).toEqual([]);
    expect(normalize([{ start: 0, end: D }], D)).toEqual([]);
  });
  it('sorts, clips, merges overlaps and touching parts, and drops slivers', () => {
    const messy = [{ start: 5000, end: 9000 }, { start: -50, end: 2000 }, { start: 2000, end: 3000 }, { start: 8000, end: 400000 }, { start: 100, end: 100 + MIN_KEPT_MS - 1 }];
    expect(keptRanges(messy, D)).toEqual([{ start: 0, end: 3000 }, { start: 5000, end: D }]);
    expect(keptRanges([{ start: 10, end: 10 + MIN_KEPT_MS - 1 }], D)).toEqual([]);
  });
});

group('cut', () => {
  it('splits a kept part in two', () => {
    expect(cut([], D, 60000, 100000)).toEqual([{ start: 0, end: 60000 }, { start: 100000, end: D }]);
  });
  it('accepts the range in either order and clamps it to the video', () => {
    expect(cut([], D, 100000, 60000)).toEqual([{ start: 0, end: 60000 }, { start: 100000, end: D }]);
    expect(cut([], D, 240000, 999999)).toEqual([{ start: 0, end: 240000 }]);
  });
  it('spans several kept parts and merges with earlier cuts', () => {
    const once = cut([], D, 60000, 100000);
    expect(cut(once, D, 50000, 120000)).toEqual([{ start: 0, end: 50000 }, { start: 120000, end: D }]);
  });
  it('never removes everything', () => {
    expect(cut([], D, 0, D)).toEqual([]);
    const some = cut([], D, 1000, 2000);
    expect(cut(some, D, -5, D + 5)).toEqual(some);
  });
  it('ignores an empty range', () => {
    expect(cut([], D, 5000, 5000)).toEqual([]);
  });
});

group('setStart and setEnd', () => {
  it('trims the start and end', () => {
    const s = setStart([], D, 6000);
    expect(s).toEqual([{ start: 6000, end: D }]);
    expect(setEnd(s, D, 245000)).toEqual([{ start: 6000, end: 245000 }]);
  });
  it('moves a trimmed start back earlier', () => {
    expect(setStart([{ start: 6000, end: D }], D, 2000)).toEqual([{ start: 2000, end: D }]);
    expect(setStart([{ start: 6000, end: D }], D, 0)).toEqual([]);
  });
  it('moves a trimmed end back later', () => {
    expect(setEnd([{ start: 0, end: 200000 }], D, 230000)).toEqual([{ start: 0, end: 230000 }]);
  });
  it('drops cuts the new start passes', () => {
    const edits = cut([], D, 60000, 100000);
    expect(setStart(edits, D, 80000)).toEqual([{ start: 100000, end: D }]);
    expect(setEnd(edits, D, 80000)).toEqual([{ start: 0, end: 60000 }]);
  });
  it('refuses a start at or past the end', () => {
    const edits = [{ start: 0, end: 200000 }];
    expect(setStart(edits, D, 200000)).toEqual(edits);
    expect(setEnd([{ start: 6000, end: D }], D, 6000)).toEqual([{ start: 6000, end: D }]);
  });
});

group('describe, restore and length', () => {
  const edits = setEnd(cut(setStart([], D, 6000), D, 60000, 100000), D, 245000);
  it('lists the frame example: start, cut, end', () => {
    expect(describe(edits, D)).toEqual([
      { kind: 'start', at: 6000 },
      { kind: 'cut', from: 60000, to: 100000 },
      { kind: 'end', at: 245000 },
    ]);
    expect(describe([], D)).toEqual([]);
  });
  it('gives the new length, 3:19 in the frame', () => {
    expect(editedLength(edits, D)).toBe(199000);
    expect(editedLength([], D)).toBe(D);
  });
  it('restores each edit alone', () => {
    const [start, middle, end] = describe(edits, D);
    expect(restore(edits, D, start!)).toEqual([{ start: 0, end: 60000 }, { start: 100000, end: 245000 }]);
    expect(restore(edits, D, middle!)).toEqual([{ start: 6000, end: 245000 }]);
    expect(restore(edits, D, end!)).toEqual([{ start: 6000, end: 60000 }, { start: 100000, end: D }]);
  });
  it('is back to the whole video once every edit is restored', () => {
    let e = edits;
    for (let item = describe(e, D)[0]; item; item = describe(e, D)[0]) e = restore(e, D, item);
    expect(e).toEqual([]);
  });
});

group('time mapping', () => {
  const edits = [{ start: 6000, end: 60000 }, { start: 100000, end: 245000 }];
  it('maps original time to edited time', () => {
    expect(toEdited(edits, D, 0)).toBe(0);
    expect(toEdited(edits, D, 6000)).toBe(0);
    expect(toEdited(edits, D, 30000)).toBe(24000);
    expect(toEdited(edits, D, 80000)).toBe(54000);
    expect(toEdited(edits, D, 100000)).toBe(54000);
    expect(toEdited(edits, D, 110000)).toBe(64000);
    expect(toEdited(edits, D, 250000)).toBe(199000);
    expect(toEdited([], D, 1234)).toBe(1234);
  });
  it('maps edited time back to original time', () => {
    expect(toOriginal(edits, D, 0)).toBe(6000);
    expect(toOriginal(edits, D, 24000)).toBe(30000);
    expect(toOriginal(edits, D, 54000)).toBe(100000);
    expect(toOriginal(edits, D, 64000)).toBe(110000);
    expect(toOriginal(edits, D, 999999)).toBe(245000);
    expect(toOriginal([], D, 1234)).toBe(1234);
  });
  it('round-trips kept times', () => {
    for (const ms of [6000, 7000, 59999, 100000, 200000, 244999]) expect(toOriginal(edits, D, toEdited(edits, D, ms))).toBe(ms);
  });
  it('skips cut parts during playback', () => {
    expect(playable([], D, 70000)).toEqual({ at: 70000, ended: false });
    expect(playable(edits, D, 1000)).toEqual({ at: 6000, ended: false });
    expect(playable(edits, D, 30000)).toEqual({ at: 30000, ended: false });
    expect(playable(edits, D, 60000)).toEqual({ at: 100000, ended: false });
    expect(playable(edits, D, 245000)).toEqual({ at: 245000, ended: true });
  });
  it('finds the kept part for a frame time in microseconds', () => {
    expect(rangeAtMicros(edits, 30_000_000)).toEqual(edits[0]);
    expect(rangeAtMicros(edits, 70_000_000)).toBeUndefined();
  });
});
