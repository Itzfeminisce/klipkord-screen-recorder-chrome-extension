import { describe, expect, it } from 'vitest';
import { SAMPLE_RATE, chunkAll, createChunker, isSilent, resample, toWav, type Chunk } from './chunker';

const tone = (samples: number, amp = 0.2) => Float32Array.from({ length: samples }, (_, i) => amp * Math.sin(i / 5));

describe('resample', () => {
  it('turns 48 kHz into a third as many samples at 16 kHz', () => {
    expect(resample(new Float32Array(48_000), 48_000).length).toBe(16_000);
    expect(resample(new Float32Array(4096), 48_000).length).toBe(1365);
    expect(resample(new Float32Array(44_100), 44_100).length).toBe(16_000);
  });
  it('keeps the shape of the signal', () => {
    const out = resample(Float32Array.from([0, 1, 2, 3, 4, 5]), 3, 1);
    expect(Array.from(out)).toEqual([0, 3]);
  });
  it('copies at the same rate', () => {
    const input = Float32Array.from([1, 2]);
    const out = resample(input, SAMPLE_RATE);
    expect(Array.from(out)).toEqual([1, 2]);
    expect(out).not.toBe(input);
  });
});

describe('createChunker', () => {
  it('cuts 10 s chunks timed in ms of voice, however the samples arrive', () => {
    const chunks: Chunk[] = [];
    const c = createChunker((ch) => chunks.push(ch));
    for (let i = 0; i < 25; i++) c.push(new Float32Array(SAMPLE_RATE)); // 25 one-second pushes
    expect(chunks.map((ch) => [ch.start, ch.end])).toEqual([[0, 10_000], [10_000, 20_000]]);
    expect(c.elapsed).toBe(25_000);
    c.flush();
    expect(chunks.map((ch) => [ch.start, ch.end])).toEqual([[0, 10_000], [10_000, 20_000], [20_000, 25_000]]);
    expect(chunks[2]!.audio.length).toBe(5 * SAMPLE_RATE);
  });
  it('drops a scrap shorter than half a second but keeps the clock', () => {
    const chunks: Chunk[] = [];
    const c = createChunker((ch) => chunks.push(ch));
    c.push(new Float32Array(SAMPLE_RATE / 10));
    c.flush();
    expect(chunks).toEqual([]);
    c.push(new Float32Array(SAMPLE_RATE));
    c.flush();
    expect(chunks.map((ch) => [ch.start, ch.end])).toEqual([[100, 1100]]);
  });
  it('chunkAll cuts a whole track', () => {
    expect(chunkAll(new Float32Array(SAMPLE_RATE * 21)).map((c) => c.end)).toEqual([10_000, 20_000, 21_000]);
  });
});

describe('isSilent and toWav', () => {
  it('tells silence from speech-level sound', () => {
    expect(isSilent(new Float32Array(1000))).toBe(true);
    expect(isSilent(tone(1000))).toBe(false);
  });
  it('writes a 16-bit mono WAV header', () => {
    const wav = new DataView(toWav(new Float32Array(160)));
    expect(wav.byteLength).toBe(44 + 320);
    expect(wav.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(wav.getUint16(22, true)).toBe(1);
  });
});
