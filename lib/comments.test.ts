import { describe, expect, it } from 'vitest';
import {
  chapterAt, currentLine, editComment, formatLength, keptLength, mapTime, needsDurationProbe, newComment, percentOf,
  resolveComment, resolvedLabel, splitComments, timeAtPoint, transcriptItems, videoSeconds,
} from './comments';
import type { Comment } from './types';

const c = (id: string, at: number, createdAt = 0, resolved = false): Comment => ({ id, at, text: id, resolved, createdAt });

describe('current line', () => {
  const segs = [{ start: 0, end: 5, text: 'a' }, { start: 5000, end: 9000, text: 'b' }, { start: 9000, end: 12000, text: 'c' }];
  it('is the last line that started', () => {
    expect(currentLine(segs, -1)).toBe(-1);
    expect(currentLine(segs, 0)).toBe(0);
    expect(currentLine(segs, 4999)).toBe(0);
    expect(currentLine(segs, 5000)).toBe(1);
    expect(currentLine(segs, 99999)).toBe(2);
    expect(currentLine([], 10)).toBe(-1);
  });
});

describe('comments', () => {
  it('orders by time, then by when written', () => {
    const { open } = splitComments([c('late', 9000), c('b', 100, 2), c('a', 100, 1)]);
    expect(open.map((x) => x.id)).toEqual(['a', 'b', 'late']);
  });
  it('resolving moves a comment into the resolved count', () => {
    const list = resolveComment([c('a', 1), c('b', 2)], 'a');
    const { open, resolved } = splitComments(list);
    expect(open.map((x) => x.id)).toEqual(['b']);
    expect(resolvedLabel(resolved.length)).toBe('1 resolved');
  });
  it('adds and edits, ignoring blank text', () => {
    expect(newComment(500.4, '   ', 'x', 1)).toBeNull();
    expect(newComment(500.4, ' hi ', 'x', 1)).toEqual({ id: 'x', at: 500, text: 'hi', resolved: false, createdAt: 1 });
    const list = [c('a', 1)];
    expect(editComment(list, 'a', ' new ')[0]?.text).toBe('new');
    expect(editComment(list, 'a', ' ')).toBe(list);
  });
});

describe('transcript items', () => {
  it('puts markers and notes between lines in time order', () => {
    const items = transcriptItems(
      [{ start: 0, end: 1, text: 'a' }, { start: 5, end: 6, text: 'b' }],
      [{ id: 'm', at: 3, kind: 'bug' }],
      [{ id: 'n', at: 5, text: 'x' }],
    );
    expect(items.map((i) => i.kind)).toEqual(['line', 'marker', 'line', 'note']);
  });
});

describe('mapTime', () => {
  it('is the identity without edits', () => {
    expect(mapTime([], 1234)).toBe(1234);
    expect(videoSeconds([], 1500, Infinity)).toBe(1.5);
  });
  it('skips cut parts', () => {
    const edits = [{ start: 0, end: 1000 }, { start: 2000, end: 3000 }];
    expect(mapTime(edits, 500)).toBe(500);
    expect(mapTime(edits, 1500)).toBe(2000);
    expect(mapTime(edits, 3000)).toBe(3000);
    expect(mapTime(edits, 9000)).toBe(3000);
    expect(mapTime([{ start: 1000, end: 2000 }], 0)).toBe(1000);
  });
  it('measures what is kept', () => {
    expect(keptLength([], 5000)).toBe(5000);
    expect(keptLength([{ start: 0, end: 1000 }, { start: 2000, end: 4000 }], 5000)).toBe(3000);
  });
});

describe('timeline maths', () => {
  it('maps clicks to times and times to percents', () => {
    expect(timeAtPoint(150, 100, 200, 60000)).toBe(15000);
    expect(timeAtPoint(50, 100, 200, 60000)).toBe(0);
    expect(timeAtPoint(900, 100, 200, 60000)).toBe(60000);
    expect(timeAtPoint(5, 0, 0, 60000)).toBe(0);
    expect(percentOf(30000, 60000)).toBe(50);
    expect(percentOf(1, 0)).toBe(0);
  });
  it('finds the chapter and formats the length', () => {
    const ch = [{ at: 0, title: 'a' }, { at: 42000, title: 'b' }];
    expect(chapterAt(ch, 41999)?.title).toBe('a');
    expect(chapterAt(ch, 42000)?.title).toBe('b');
    expect(chapterAt([{ at: 5000, title: 'x' }], 100)).toBeUndefined();
    expect(formatLength(252000)).toBe('4:12');
  });
  it('probes only when the video does not know its length', () => {
    expect(needsDurationProbe(Infinity)).toBe(true);
    expect(needsDurationProbe(NaN)).toBe(true);
    expect(needsDurationProbe(12)).toBe(false);
    expect(videoSeconds([], 99000, 10)).toBe(10);
  });
});
