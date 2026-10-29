import { describe, expect, it } from 'vitest';
import { formatBytes, formatClock, formatDuration } from './time';

describe('time', () => {
  it('formats clock offsets', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(228_000)).toBe('03:48');
    expect(formatClock(724_999)).toBe('12:04');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(formatClock(NaN)).toBe('00:00');
    expect(formatClock(-5)).toBe('00:00');
  });
  it('formats durations', () => {
    expect(formatDuration(42 * 60_000)).toBe('42 min');
    expect(formatDuration(65 * 60_000)).toBe('1 h 5 min');
    expect(formatDuration(120 * 60_000)).toBe('2 h');
    expect(formatDuration(NaN)).toBe('0 min');
  });
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2 GB');
    expect(formatBytes(300 * 1024 ** 2)).toBe('300 MB');
  });
});
