import { describe, expect, it } from 'vitest';
import { downloadSummary, frameStats, levelDb, mean, megabytes, realTimeFactor } from './stats';

describe('frameStats', () => {
  it('reports steady 30 fps with no drops', () => {
    const times = Array.from({ length: 31 }, (_, i) => i * (1000 / 30));
    expect(frameStats(times, 30)).toEqual({ frames: 31, meanFps: 30, droppedFrames: 0 });
  });

  it('counts missing frames in a gap', () => {
    const p = 1000 / 30;
    const times = [0, p, 2 * p, 5 * p, 6 * p];
    expect(frameStats(times, 30).droppedFrames).toBe(2);
  });

  it('handles too few frames', () => {
    expect(frameStats([5], 30)).toEqual({ frames: 1, meanFps: 0, droppedFrames: 0 });
  });
});

describe('numbers', () => {
  it('computes mean, real-time factor and megabytes', () => {
    expect(mean([])).toBe(0);
    expect(mean([2, 4])).toBe(3);
    expect(realTimeFactor(2500, 10000)).toBe(0.25);
    expect(realTimeFactor(100, 0)).toBe(0);
    expect(megabytes(145_600_000)).toBe(145.6);
  });

  it('measures level in dBFS', () => {
    expect(levelDb(new Float32Array([0, 0]))).toBeNull();
    expect(levelDb(new Float32Array([]))).toBeNull();
    expect(levelDb(new Float32Array([1, -1]))).toBe(0);
    expect(levelDb(new Float32Array([0.1, -0.1]))).toBe(-20);
  });
});

describe('downloadSummary', () => {
  it('sums partial files and is not done', () => {
    const s = downloadSummary([
      { loaded: 5, total: 10, done: false },
      { loaded: 20, total: 20, done: true },
    ]);
    expect(s).toEqual({ files: 2, doneFiles: 1, loadedBytes: 25, totalBytes: 30, allDone: false });
  });
  it('is done when every file is done', () => {
    expect(downloadSummary([{ loaded: 0, total: 7, done: true }])).toMatchObject({ loadedBytes: 7, allDone: true });
  });
  it('is not done with no files', () => {
    expect(downloadSummary([]).allDone).toBe(false);
  });
});
