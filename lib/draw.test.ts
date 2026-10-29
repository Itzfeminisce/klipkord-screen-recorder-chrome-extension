import { describe, expect, it } from 'vitest';
import { RING_MS, drawAvailability, hostOf, originPattern, ringAt, smoothPoint, smoothStroke } from './draw';

describe('stroke smoothing', () => {
  it('starts where the pointer went down and moves halfway toward each new point', () => {
    expect(smoothPoint(undefined, { x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
    expect(smoothPoint({ x: 0, y: 0 }, { x: 10, y: -4 })).toEqual({ x: 5, y: -2 });
  });

  it('takes the jitter out of a line and keeps both ends', () => {
    const raw = [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: -8 }, { x: 30, y: 8 }, { x: 40, y: 0 }];
    const out = smoothStroke(raw);
    expect(out[0]).toEqual(raw[0]);
    expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
    const swing = (pts: { y: number }[]) => Math.max(...pts.map((p) => Math.abs(p.y)));
    expect(swing(out.slice(1, -1))).toBeLessThan(swing(raw.slice(1, -1)));
  });

  it('leaves a dot and an empty stroke alone', () => {
    expect(smoothStroke([])).toEqual([]);
    expect(smoothStroke([{ x: 3, y: 4 }])).toEqual([{ x: 3, y: 4 }]);
  });
});

describe('click ring timing', () => {
  it('grows and fades out over 600 ms, then is gone', () => {
    expect(RING_MS).toBe(600);
    const start = ringAt(0)!;
    const mid = ringAt(300)!;
    expect(start.opacity).toBeGreaterThan(mid.opacity);
    expect(mid.radius).toBeGreaterThan(start.radius);
    expect(ringAt(599)!.opacity).toBeGreaterThan(0);
    expect(ringAt(600)).toBeNull();
    expect(ringAt(-1)).toBeNull();
  });
});

describe('draw switch per capture mode', () => {
  const live = (mode: 'tab' | 'window' | 'screen', status: 'recording' | 'paused' | 'idle' = 'recording') => ({ status, mode });

  it('draws on a tab and shows the web-only card for a window or the screen', () => {
    expect(drawAvailability(live('tab'))).toBe('tab');
    expect(drawAvailability(live('tab', 'paused'))).toBe('tab');
    expect(drawAvailability(live('window'))).toBe('web-only');
    expect(drawAvailability(live('screen'))).toBe('web-only');
  });

  it('is off when nothing is recording', () => {
    expect(drawAvailability(live('tab', 'idle'))).toBe('off');
    expect(drawAvailability(null)).toBe('off');
  });
});

describe('site access', () => {
  it('asks for the web page origin only', () => {
    expect(originPattern('https://acme-store.example/checkout?x=1')).toBe('https://acme-store.example/*');
    expect(originPattern('http://localhost:3000/a')).toBe('http://localhost:3000/*');
    expect(hostOf('https://acme-store.example/checkout')).toBe('acme-store.example');
  });

  it('has nothing to ask for on pages Chrome keeps from extensions', () => {
    expect(originPattern('chrome://settings')).toBeNull();
    expect(originPattern(undefined)).toBeNull();
    expect(originPattern('not a url')).toBeNull();
    expect(hostOf('chrome-extension://abc/offscreen.html')).toBeNull();
  });
});
