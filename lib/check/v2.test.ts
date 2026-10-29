import { describe, expect, it } from 'vitest';
import { checkWordTimes, gifFramePlan, wordLine } from './v2';

describe('gifFramePlan', () => {
  it('plans 15 s at 12 fps and 640 px', () => {
    expect(gifFramePlan(15, 12, 640)).toEqual({ frames: 180, width: 640, height: 360, delayMs: 80, playedFps: 12.5 });
  });
  it('keeps the height even', () => {
    expect(gifFramePlan(1, 10, 642).height % 2).toBe(0);
  });
  it('never asks for a delay under 2 hundredths', () => {
    expect(gifFramePlan(1, 100, 640).delayMs).toBe(20);
  });
  it('returns nothing for empty input', () => {
    expect(gifFramePlan(0, 12, 640).frames).toBe(0);
  });
});

describe('checkWordTimes', () => {
  it('passes ordered words inside the clip', () => {
    const words = [
      { text: ' Hello', start: 0.2, end: 0.5 },
      { text: ' there', start: 0.5, end: 0.9 },
    ];
    expect(checkWordTimes(words, 60)).toEqual({ words: 2, missingTimes: 0, outOfOrder: 0, pastClip: 0, lastEndS: 0.9 });
  });
  it('counts missing, backwards and past-the-clip times', () => {
    const words = [
      { text: 'a', start: 5, end: 6 },
      { text: 'b', start: 4, end: 4.5 },
      { text: 'c', start: 7, end: null },
      { text: 'd', start: 59, end: 61 },
    ];
    expect(checkWordTimes(words, 60)).toMatchObject({ missingTimes: 1, outOfOrder: 1, pastClip: 1, lastEndS: 61 });
  });
});

describe('wordLine', () => {
  it('shows the first words with their times', () => {
    expect(wordLine([{ text: ' Hi', start: 0, end: 0.25 }, { text: ' you', start: 0.3, end: null }], 1)).toBe('Hi [0.00-0.25]');
    expect(wordLine([{ text: ' you', start: 0.3, end: null }])).toBe('you [0.30-?]');
  });
});
