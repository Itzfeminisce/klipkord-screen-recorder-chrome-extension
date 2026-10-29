import { describe, expect, it } from 'vitest';
import {
  badgeTitle, chooseMime, chooseVoiceMime, clockElapsed, clockPause, clockResume, clockStart, containerOf, createChunkWriter, shortClock,
} from './recorder';

describe('clock', () => {
  it('counts only the time spent recording, across pauses', () => {
    let c = clockStart(1000);
    expect(clockElapsed(c, 4000)).toBe(3000);
    c = clockPause(c, 4000);
    expect(clockElapsed(c, 60_000)).toBe(3000);
    c = clockResume(c, 60_000);
    expect(clockElapsed(c, 62_500)).toBe(5500);
    c = clockPause(clockPause(c, 63_000), 99_000);
    expect(clockElapsed(c, 120_000)).toBe(6000);
    expect(clockElapsed(clockResume(clockResume(c, 200_000), 300_000), 201_000)).toBe(7000);
  });
});

describe('labels', () => {
  it('formats the badge and its title', () => {
    expect(shortClock(252_000)).toBe('4:12');
    expect(shortClock(754_000)).toBe('12:34');
    expect(badgeTitle(252_000)).toBe('Klipkord is recording, 4 minutes 12 seconds');
    expect(badgeTitle(61_000)).toBe('Klipkord is recording, 1 minute 1 second');
  });
});

describe('mime choice', () => {
  const only = (...types: string[]) => (t: string) => types.includes(t);
  it('prefers MP4 H.264 + AAC', () => {
    expect(chooseMime(only('video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus'), true)).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  });
  it('falls back to WebM VP9 + Opus', () => {
    expect(chooseMime(only('video/webm;codecs=vp9,opus', 'video/webm'), true)).toBe('video/webm;codecs=vp9,opus');
  });
  it('asks for no audio codec when there is no sound', () => {
    expect(chooseMime(only('video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2'), false)).toBe('video/mp4;codecs=avc1.42E01E');
  });
  it('leaves the choice to Chrome when nothing listed is supported', () => {
    expect(chooseMime(() => false, true)).toBe('');
  });
  it('records the voice as Opus', () => {
    expect(chooseVoiceMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(containerOf('video/mp4;codecs=avc1.42E01E')).toBe('video/mp4');
    expect(containerOf('video/webm;codecs=vp9')).toBe('video/webm');
  });
});

describe('chunk writer', () => {
  it('appends chunks in arrival order even when writes finish out of order', async () => {
    const written: string[] = [];
    const delays = [30, 0, 10];
    let i = 0;
    const writer = createChunkWriter(async (chunk) => {
      await new Promise((r) => setTimeout(r, delays[i++ % delays.length]));
      written.push(await chunk.text());
    });
    ['a', 'bb', 'ccc', 'dddd'].forEach((s) => writer.write(new Blob([s])));
    writer.write(new Blob([]));
    await writer.flush();
    expect(written).toEqual(['a', 'bb', 'ccc', 'dddd']);
    expect(writer.bytes).toBe(10);
  });

  it('keeps writing after a failed chunk and reports it', async () => {
    const written: string[] = [];
    const errors: unknown[] = [];
    const writer = createChunkWriter(async (chunk) => {
      const s = await chunk.text();
      if (s === 'bad') throw new Error('disk');
      written.push(s);
    }, (e) => errors.push(e));
    ['one', 'bad', 'two'].forEach((s) => writer.write(new Blob([s])));
    await writer.flush();
    expect(written).toEqual(['one', 'two']);
    expect(errors).toHaveLength(1);
  });
});
