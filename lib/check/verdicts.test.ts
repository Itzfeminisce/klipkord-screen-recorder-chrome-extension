import { describe, expect, it } from 'vitest';
import { builtinAiNote, captureTarget, chromeMajor, smallSkipNote, soundStatus } from './verdicts';

describe('soundStatus', () => {
  it('warns on silence and near-silence', () => {
    expect(soundStatus(-99.5)).toBe('warn');
    expect(soundStatus(-60.1)).toBe('warn');
    expect(soundStatus(null)).toBe('warn');
  });
  it('passes on audible sound', () => {
    expect(soundStatus(-60)).toBe('pass');
    expect(soundStatus(-12)).toBe('pass');
  });
});

describe('chromeMajor', () => {
  it('reads a full version or a user agent', () => {
    expect(chromeMajor('132.0.6834.160')).toBe(132);
    expect(chromeMajor('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36')).toBe(138);
    expect(chromeMajor(null)).toBeNull();
    expect(chromeMajor('unknown')).toBeNull();
  });
});

describe('builtinAiNote', () => {
  it('notes the version when an API is missing on old Chrome', () => {
    expect(builtinAiNote(132, ['missing', 'missing'])).toBe('needs Chrome 138 or newer');
  });
  it('says nothing on new Chrome, unknown versions or when present', () => {
    expect(builtinAiNote(138, ['missing'])).toBeNull();
    expect(builtinAiNote(null, ['missing'])).toBeNull();
    expect(builtinAiNote(132, ['available', 'downloadable'])).toBeNull();
  });
});

describe('captureTarget', () => {
  it('uses the real screen size when it is smaller than 1080p', () => {
    expect(captureTarget({ width: 1366, height: 768 })).toEqual({ width: 1366, height: 768 });
  });
  it('caps larger screens at 1080p, keeping the shape', () => {
    expect(captureTarget({ width: 3840, height: 2160 })).toEqual({ width: 1920, height: 1080 });
    expect(captureTarget({ width: 2560, height: 1600 })).toEqual({ width: 1728, height: 1080 });
  });
  it('rounds to even sizes', () => {
    expect(captureTarget({ width: 1365, height: 767 })).toEqual({ width: 1364, height: 766 });
  });
});

describe('smallSkipNote', () => {
  it('runs small when base is fast', () => {
    expect(smallSkipNote(0.3)).toBeNull();
  });
  it('skips small at or above the limit, with a note', () => {
    expect(smallSkipNote(0.5)).toContain('0.5');
    expect(smallSkipNote(1.2)).toContain('skipped');
  });
  it('skips small with no base number', () => {
    expect(smallSkipNote(null)).toContain('skipped');
  });
});
