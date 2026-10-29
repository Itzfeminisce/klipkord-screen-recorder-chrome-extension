import { describe, expect, it } from 'vitest';
import { audioSlices, editedMicros, encodePlan, opensPart, targetBitrate } from './plan';

const D = 10000;
const plan = encodePlan([{ start: 1000, end: 3000 }, { start: 5000, end: D }], D);

describe('encodePlan', () => {
  it('keeps everything with no edits and runs the last part to the end of the media', () => {
    expect(encodePlan([], D)).toEqual([{ start: 0, end: Infinity }]);
    expect(encodePlan([], 0)).toEqual([{ start: 0, end: Infinity }]);
    expect(plan).toEqual([{ start: 1000, end: 3000 }, { start: 5000, end: Infinity }]);
    expect(encodePlan([{ start: 0, end: 4000 }], D)).toEqual([{ start: 0, end: 4000 }]);
  });
});

describe('editedMicros and opensPart', () => {
  it('drops frames in cuts and closes the gaps', () => {
    expect(editedMicros(plan, 500_000)).toBeNull();
    expect(editedMicros(plan, 1_000_000)).toBe(0);
    expect(editedMicros(plan, 2_500_000)).toBe(1_500_000);
    expect(editedMicros(plan, 4_000_000)).toBeNull();
    expect(editedMicros(plan, 5_000_000)).toBe(2_000_000);
    expect(editedMicros(plan, 12_000_000)).toBe(9_000_000);
  });
  it('marks the first frame of each kept part', () => {
    expect(opensPart(plan, 1_000_000, null)).toBe(true);
    expect(opensPart(plan, 1_033_000, 1_000_000)).toBe(false);
    expect(opensPart(plan, 5_010_000, 2_990_000)).toBe(true);
  });
});

describe('audioSlices', () => {
  it('keeps a whole buffer inside a kept part', () => {
    expect(audioSlices(plan, 2_000_000, 960, 48000)).toEqual([{ offset: 0, count: 960, timestamp: 1_000_000 }]);
  });
  it('trims a buffer that crosses into a cut', () => {
    expect(audioSlices(plan, 2_990_000, 960, 48000)).toEqual([{ offset: 0, count: 480, timestamp: 1_990_000 }]);
    expect(audioSlices(plan, 4_990_000, 960, 48000)).toEqual([{ offset: 480, count: 480, timestamp: 2_000_000 }]);
  });
  it('drops a buffer inside a cut', () => {
    expect(audioSlices(plan, 4_000_000, 960, 48000)).toEqual([]);
  });
  it('splits a buffer that spans a whole cut', () => {
    const narrow = encodePlan([{ start: 0, end: 1000 }, { start: 1010, end: D }], D);
    expect(audioSlices(narrow, 990_000, 1440, 48000)).toEqual([
      { offset: 0, count: 480, timestamp: 990_000 },
      { offset: 960, count: 480, timestamp: 1_000_000 },
    ]);
  });
});

describe('targetBitrate', () => {
  it('follows the recording and stays in range', () => {
    expect(targetBitrate(0, 0)).toBe(5e6);
    expect(targetBitrate(3_750_000, 10_000)).toBe(3e6);
    expect(targetBitrate(100, 10_000)).toBe(1e6);
    expect(targetBitrate(1e9, 1000)).toBe(16e6);
  });
});
