import { describe, expect, it } from 'vitest';
import { sniff } from './demux';
import { audioTrack, createWebmDemuxer, readVint, videoTrack } from './webm';

const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const idBytes = (id: number) => { const out: number[] = []; for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff); return out; };
const size = (n: number) => (n < 127 ? [0x80 | n] : [0x40 | (n >> 8), n & 0xff]);
const el = (id: number, body: number[]) => [...idBytes(id), ...size(body.length), ...body];
const open = (id: number) => [...idBytes(id), ...UNKNOWN];
const str = (s: string) => Array.from(new TextEncoder().encode(s));
const f64 = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n); return Array.from(b); };
const block = (track: number, rel: number, key: boolean, payload: number[]) => el(0xa3, [0x80 | track, (rel >> 8) & 0xff, rel & 0xff, key ? 0x80 : 0, ...payload]);

const file = new Uint8Array([
  ...el(0x1a45dfa3, el(0x4282, str('webm'))),
  ...open(0x18538067),
  ...el(0x1549a966, el(0x2ad7b1, [0x0f, 0x42, 0x40])),
  ...el(0x1654ae6b, [
    ...el(0xae, [...el(0xd7, [1]), ...el(0x86, str('A_OPUS')), ...el(0x63a2, str('OpusHead')), ...el(0xe1, [...el(0xb5, f64(48000)), ...el(0x9f, [2])])]),
    ...el(0xae, [...el(0xd7, [2]), ...el(0x86, str('V_VP8')), ...el(0xe0, [...el(0xb0, [0x05, 0x00]), ...el(0xba, [0x02, 0xd0])])]),
  ]),
  ...el(0xec, [0, 0, 0, 0, 0, 0]), // Void, skipped
  ...open(0x1f43b675), ...el(0xe7, [0]),
  ...block(2, 0, true, [1, 2, 3]), ...block(1, 0, true, [9]), ...block(2, 33, false, [4, 5]),
  ...open(0x1f43b675), ...el(0xe7, [0x03, 0xe8]),
  ...block(2, -1, false, [6]), ...block(1, 20, true, [8]),
]);

describe('readVint', () => {
  it('reads sizes, ids and the unknown size', () => {
    expect(readVint(new Uint8Array([0x81]), 0, false)).toEqual({ value: 1, length: 1, unknown: false });
    expect(readVint(new Uint8Array([0x40, 0x02]), 0, false)).toEqual({ value: 2, length: 2, unknown: false });
    expect(readVint(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), 0, true)?.value).toBe(0x1a45dfa3);
    expect(readVint(new Uint8Array(UNKNOWN), 0, false)?.unknown).toBe(true);
    expect(readVint(new Uint8Array([0x40]), 0, false)).toBeNull();
  });
});

describe('createWebmDemuxer', () => {
  function run(step: number) {
    const d = createWebmDemuxer();
    const packets = [];
    for (let i = 0; i < file.length; i += step) packets.push(...d.push(file.subarray(i, i + step)));
    packets.push(...d.end());
    return { packets, tracks: d.tracks() };
  }

  it('reads the tracks and every block with its time, whatever the chunk size', () => {
    for (const step of [1, 3, 17, file.length]) {
      const { packets, tracks } = run(step);
      expect(tracks?.video).toMatchObject({ codec: 'vp8', width: 1280, height: 720 });
      expect(tracks?.audio).toMatchObject({ codec: 'opus', sampleRate: 48000, channels: 2 });
      expect(packets.map((p) => [p.track, p.key, p.timestamp, Array.from(p.data)])).toEqual([
        ['video', true, 0, [1, 2, 3]], ['audio', true, 0, [9]], ['video', false, 33000, [4, 5]],
        ['video', false, 999000, [6]], ['audio', true, 1020000, [8]],
      ]);
    }
  });

  it('refuses laced blocks', () => {
    const d = createWebmDemuxer();
    const laced = new Uint8Array([...file, ...el(0xa3, [0x82, 0, 0, 0x82, 0])]);
    expect(() => { d.push(laced); d.end(); }).toThrow('laced');
  });
});

describe('codec configs', () => {
  it('maps Matroska codec ids to WebCodecs strings', () => {
    expect(videoTrack({ codecId: 'V_VP9', width: 2, height: 2 })?.codec).toBe('vp09.00.10.08');
    expect(videoTrack({ codecId: 'V_MPEG4/ISO/AVC', priv: new Uint8Array([1, 0x64, 0, 0x1f, 0xff]) })?.codec).toBe('avc1.64001f');
    expect(videoTrack({ codecId: 'V_THEORA' })).toBeNull();
    expect(audioTrack({ codecId: 'A_AAC' })?.codec).toBe('mp4a.40.2');
    expect(audioTrack({ codecId: 'A_VORBIS' })).toBeNull();
  });
  it('sniffs the container', () => {
    expect(sniff(file.subarray(0, 16))).toBe('webm');
    expect(sniff(new Uint8Array([0, 0, 0, 24, ...str('ftypisom')]))).toBe('mp4');
    expect(sniff(new Uint8Array(16))).toBeNull();
  });
});
