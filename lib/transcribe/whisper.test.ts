import { describe, expect, it } from 'vitest';
import { BASE_MODEL, EXPECTED_BYTES, LIVE_MODEL, liveModel, summarize, timeLeft, track, type FileProgress } from './whisper';

describe('whisper models and download progress', () => {
  it('live uses tiny, or base with WebGPU', () => {
    expect(liveModel(false)).toBe(LIVE_MODEL);
    expect(liveModel(true)).toBe(BASE_MODEL);
  });
  it('sums files across both models against the expected size', () => {
    const files = new Map<string, FileProgress>();
    track(files, { model: LIVE_MODEL, status: 'progress', file: 'a.onnx', loaded: 10_000_000, total: 40_000_000 });
    track(files, { model: BASE_MODEL, status: 'progress', file: 'a.onnx', loaded: 5_000_000, total: 80_000_000 });
    const s = summarize(files.values());
    expect(s.loaded).toBe(15_000_000);
    expect(s.total).toBe(EXPECTED_BYTES);
    expect(s.percent).toBe(12);
    track(files, { model: LIVE_MODEL, status: 'done', file: 'a.onnx', loaded: 0, total: 0 });
    expect(summarize(files.values()).loaded).toBe(45_000_000);
    expect(summarize(files.values(), 0, true).percent).toBe(100);
  });
  it('estimates time left from the rate so far', () => {
    expect(timeLeft(0, 100, 5000)).toBeNull();
    expect(timeLeft(50, 100, 10_000)).toBe('about 1 minute left');
    expect(timeLeft(10, 100, 60_000)).toBe('about 9 minutes left');
  });
});
