import { describe, expect, it } from 'vitest';
import { PAD_MS, rmsLevels, silenceRanges } from './silence';

const quiet = (n: number) => Array<number>(n).fill(0);
const loud = (n: number) => Array<number>(n).fill(0.2);

describe('rmsLevels', () => {
  it('measures each window', () => {
    const samples = new Float32Array(200).fill(0.5);
    samples.fill(0, 100);
    expect(rmsLevels(samples, 1000, 100)).toEqual([0.5, 0]);
  });
});

describe('silenceRanges', () => {
  it('keeps 0.3 s of padding on both sides of a pause', () => {
    // 1 s speech, 3 s quiet, 1 s speech at 50 ms windows
    const levels = [...loud(20), ...quiet(60), ...loud(20)];
    expect(silenceRanges(levels, 50, 2000)).toEqual([{ start: 1000 + PAD_MS, end: 4000 - PAD_MS }]);
  });
  it('ignores pauses shorter than the minimum', () => {
    const levels = [...loud(20), ...quiet(30), ...loud(20)];
    expect(silenceRanges(levels, 50, 2000)).toEqual([]);
    expect(silenceRanges(levels, 50, 1000)).toHaveLength(1);
  });
  it('closes a pause that runs to the end', () => {
    const levels = [...loud(10), ...quiet(60)];
    expect(silenceRanges(levels, 50, 2000)).toEqual([{ start: 500 + PAD_MS, end: 3500 - PAD_MS }]);
  });
  it('drops a pause the padding would swallow', () => {
    expect(silenceRanges(quiet(10), 50, 400)).toEqual([]);
  });
});
