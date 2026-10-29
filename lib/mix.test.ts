import { describe, expect, it } from 'vitest';
import { createSilenceWatch, meterBars, rms } from './mix';

describe('mic level', () => {
  it('measures RMS and lights meter bars', () => {
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(meterBars(0)).toBe(0);
    expect(meterBars(1)).toBe(8);
    expect(meterBars(0.05)).toBeGreaterThan(0);
  });
});

describe('silent mic', () => {
  it('fires after 30 s of silence and resets on sound or mute', () => {
    const watch = createSilenceWatch(30_000);
    expect(watch(0, 0, false)).toBe(false);
    expect(watch(0, 29_000, false)).toBe(false);
    expect(watch(0, 30_000, false)).toBe(true);
    expect(watch(0.1, 31_000, false)).toBe(false);
    expect(watch(0, 32_000, true)).toBe(false);
    expect(watch(0, 61_000, false)).toBe(false);
  });
});
