import { describe, expect, it } from 'vitest';
import {
  IDLE_MS, controlsVisible, currentCaption, currentChapterTitle, hideDelay, nextSpeed, speedLabel, timeLabel,
} from './player';

describe('speed', () => {
  it('cycles 1x, 1.25x, 1.5x, 2x, 0.75x and back', () => {
    const seen = [1];
    for (let i = 0; i < 5; i++) seen.push(nextSpeed(seen[i]!));
    expect(seen.map(speedLabel)).toEqual(['1x', '1.25x', '1.5x', '2x', '0.75x', '1x']);
  });
  it('restarts at 1x from an unknown rate', () => expect(nextSpeed(3)).toBe(1));
});

describe('labels', () => {
  it('shows playhead and length', () => expect(timeLabel(96000, 252000)).toBe('01:36 / 4:12'));
  it('names the chapter that has started', () => {
    const ch = [{ at: 0, title: 'Intro' }, { at: 40000, title: 'Adding items' }];
    expect(currentChapterTitle(ch, 96000)).toBe('Adding items');
    expect(currentChapterTitle([], 1)).toBeUndefined();
  });
});

describe('caption', () => {
  const segs = [{ start: 0, end: 4000, text: ' Hello ' }, { start: 6000, end: 9000, text: 'World' }];
  it('is the segment spoken now', () => {
    expect(currentCaption(segs, 1000)).toBe('Hello');
    expect(currentCaption(segs, 6000)).toBe('World');
  });
  it('is empty in a gap and past the end', () => {
    expect(currentCaption(segs, 5000)).toBeUndefined();
    expect(currentCaption(segs, 9000)).toBeUndefined();
    expect(currentCaption([], 0)).toBeUndefined();
  });
});

describe('idle hide', () => {
  it('always shows while paused', () => expect(controlsVisible(false, 0, 99999)).toBe(true));
  it('hides after 3 s of no movement while playing', () => {
    expect(controlsVisible(true, 1000, 1000 + IDLE_MS - 1)).toBe(true);
    expect(controlsVisible(true, 1000, 1000 + IDLE_MS)).toBe(false);
  });
  it('waits out the rest of the 3 s', () => {
    expect(hideDelay(true, 1000, 2000)).toBe(2000);
    expect(hideDelay(true, 0, 5000)).toBe(0);
    expect(hideDelay(false, 0, 100)).toBe(0);
  });
});
