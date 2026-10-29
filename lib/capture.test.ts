import { describe, expect, it } from 'vitest';
import { captureSize, pickerSources } from './capture';

describe('picker sources', () => {
  it('offers sound for a tab and the screen, never for a window', () => {
    expect(pickerSources('tab', true)).toEqual(['tab', 'audio']);
    expect(pickerSources('screen', true)).toEqual(['screen', 'audio']);
    expect(pickerSources('window', true)).toEqual(['window']);
    expect(pickerSources('tab', false)).toEqual(['tab']);
  });
});

describe('capture size', () => {
  it('caps 1080p at the real screen size', () => {
    expect(captureSize('1080p', 1366, 768)).toEqual({ maxWidth: 1366, maxHeight: 768 });
    expect(captureSize('1080p', 2560, 1440)).toEqual({ maxWidth: 1920, maxHeight: 1080 });
    expect(captureSize('720p', 1366, 768)).toEqual({ maxWidth: 1280, maxHeight: 720 });
    expect(captureSize('720p', 0, 0)).toEqual({ maxWidth: 1280, maxHeight: 720 });
  });
});
