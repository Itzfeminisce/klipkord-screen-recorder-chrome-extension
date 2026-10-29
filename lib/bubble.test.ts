import { describe, expect, it } from 'vitest';
import {
  BUBBLE_SHARE, CORNERS, FLOATING_SIDE, SIZES, bubbleMode, bubbleRect, fitRect, floatsBubble, squareCrop, stepSize,
} from './bubble';

describe('floatsBubble', () => {
  const floating = { corner: 'bottom-left', size: 'M', mode: 'floating' } as const;
  const video = { ...floating, mode: 'video' } as const;
  const old = { corner: 'bottom-left', size: 'M' } as const;

  it('floats for a window or the whole screen with "Floating on screen"', () => {
    expect(floatsBubble('window', floating, true)).toBe(true);
    expect(floatsBubble('screen', floating, true)).toBe(true);
  });
  it('treats a setting without a mode as floating', () => {
    expect(bubbleMode(old)).toBe('floating');
    expect(floatsBubble('screen', old, true)).toBe(true);
  });
  it('always draws into a tab recording', () => {
    expect(floatsBubble('tab', floating, true)).toBe(false);
  });
  it('draws with "Drawn into the video"', () => {
    expect(floatsBubble('window', video, true)).toBe(false);
    expect(floatsBubble('screen', video, true)).toBe(false);
  });
  it('has nothing to float with the camera off', () => {
    expect(floatsBubble('screen', floating, false)).toBe(false);
    expect(floatsBubble(undefined, floating, true)).toBe(false);
  });
});

describe('stepSize', () => {
  it('steps up and down one size', () => {
    expect(stepSize('S', 1)).toBe('M');
    expect(stepSize('M', 1)).toBe('L');
    expect(stepSize('L', -1)).toBe('M');
    expect(stepSize('M', -1)).toBe('S');
  });
  it('stays at the ends', () => {
    expect(stepSize('L', 1)).toBe('L');
    expect(stepSize('S', -1)).toBe('S');
  });
  it('grows the floating window with each size', () => {
    expect(FLOATING_SIDE.S).toBeLessThan(FLOATING_SIDE.M);
    expect(FLOATING_SIDE.M).toBeLessThan(FLOATING_SIDE.L);
  });
});

describe('bubbleRect', () => {
  const W = 1920;
  const H = 1080;
  const gap = Math.round(H * 0.037);

  for (const size of SIZES) {
    for (const corner of CORNERS) {
      it(`${corner} ${size} sits in its corner with the margin`, () => {
        const r = bubbleRect(W, H, { corner, size });
        expect(r.d).toBe(Math.round(H * BUBBLE_SHARE[size]));
        expect(r.x).toBe(corner.endsWith('left') ? gap : W - gap - r.d);
        expect(r.y).toBe(corner.startsWith('top') ? gap : H - gap - r.d);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y + r.d).toBeLessThanOrEqual(H);
      });
    }
  }

  it('grows S < M < L', () => {
    const [s, m, l] = SIZES.map((size) => bubbleRect(W, H, { corner: 'bottom-left', size }).d);
    expect(s).toBeLessThan(m!);
    expect(m).toBeLessThan(l!);
  });

  it('uses the shorter side for a portrait frame', () => {
    expect(bubbleRect(1080, 1920, { corner: 'top-left', size: 'M' }).d).toBe(Math.round(1080 * 0.36));
  });

  it('takes a margin in px for the panel preview', () => {
    expect(bubbleRect(352, 196, { corner: 'bottom-right', size: 'M' }, 26)).toEqual({ x: 352 - 26 - 71, y: 196 - 26 - 71, d: 71 });
  });

  it('never overflows a tiny frame', () => {
    const r = bubbleRect(40, 40, { corner: 'top-right', size: 'L' }, 15);
    expect(r.d).toBe(10);
    expect(r.x + r.d).toBeLessThanOrEqual(40 - 15);
  });
});

describe('squareCrop', () => {
  it('centres a square in a landscape camera', () => {
    expect(squareCrop(640, 480)).toEqual({ x: 80, y: 0, width: 480, height: 480 });
  });
  it('centres a square in a portrait camera', () => {
    expect(squareCrop(480, 640)).toEqual({ x: 0, y: 80, width: 480, height: 480 });
  });
});

describe('fitRect', () => {
  it('fills an output of the same shape', () => {
    expect(fitRect(1280, 720, 1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
  it('letterboxes a narrower source', () => {
    expect(fitRect(1000, 1000, 1920, 1080)).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
  });
  it('fills the output when the source has no size yet', () => {
    expect(fitRect(0, 0, 1280, 720)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });
});
