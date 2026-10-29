import { describe, expect, it } from 'vitest';
import { GIF_DELAY_MS, GIF_MAX_MS, checkRange, estimateGifBytes, frameCount, frameTimes, gifFileName, gifHeight } from './gifPlan';

describe('gifPlan', () => {
  it('caps the range at 15 s', () => {
    expect(checkRange({ start: 0, end: GIF_MAX_MS })).toBe('ok');
    expect(checkRange({ start: 0, end: GIF_MAX_MS + 1 })).toBe('gif-too-long');
    expect(checkRange({ start: 5000, end: 5000 })).toBe('empty');
  });

  it('draws one frame every 80 ms', () => {
    expect(frameCount({ start: 0, end: 15000 })).toBe(187);
    expect(frameTimes([], 60000, { start: 1000, end: 1400 })).toEqual([1000, 1080, 1160, 1240, 1320]);
    expect(GIF_DELAY_MS).toBe(80);
  });

  it('takes frame times from the edited video, jumping over cuts', () => {
    // Kept 0-1000 and 5000-6000: edited 1000 ms is original 5000 ms.
    const edits = [{ start: 0, end: 1000 }, { start: 5000, end: 6000 }];
    expect(frameTimes(edits, 10000, { start: 880, end: 1240 })).toEqual([880, 960, 5040, 5120]);
  });

  it('stops at the end of the edited video', () => {
    const edits = [{ start: 2000, end: 2400 }];
    expect(frameTimes(edits, 10000, { start: 0, end: 15000 })).toEqual([2000, 2080, 2160, 2240, 2320]);
  });

  it('estimates size from the T0 measurement', () => {
    const full = estimateGifBytes({ start: 0, end: 15000 });
    expect(full).toBeGreaterThan(3_000_000);
    expect(full).toBeLessThan(3_500_000);
    expect(estimateGifBytes({ start: 0, end: 7500 })).toBeLessThan(full * 0.6);
    expect(estimateGifBytes({ start: 0, end: 15000 }, 640, 480)).toBeGreaterThan(full);
  });

  it('keeps the recording shape with an even height', () => {
    expect(gifHeight(1920, 1080)).toBe(360);
    expect(gifHeight(0, 0)).toBe(360);
    expect(gifHeight(1280, 1024) % 2).toBe(0);
  });

  it('names the file from the title and the clip start', () => {
    expect(gifFileName('Checkout freezes', 42_000)).toBe('checkout-freezes-0042.gif');
    expect(gifFileName('???', 0)).toBe('klipkord-0000.gif');
  });
});
