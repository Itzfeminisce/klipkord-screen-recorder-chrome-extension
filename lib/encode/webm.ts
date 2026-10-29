import type { AudioTrack, Demuxer, Packet, Tracks, VideoTrack } from './demux';

// Matroska element ids (marker bits kept), as MediaRecorder writes them.
const ID = {
  Segment: 0x18538067, Info: 0x1549a966, Tracks: 0x1654ae6b, TrackEntry: 0xae, Video: 0xe0, Audio: 0xe1,
  Cluster: 0x1f43b675, BlockGroup: 0xa0, TimecodeScale: 0x2ad7b1, TrackNumber: 0xd7, CodecID: 0x86,
  CodecPrivate: 0x63a2, PixelWidth: 0xb0, PixelHeight: 0xba, SamplingFrequency: 0xb5, Channels: 0x9f,
  Timecode: 0xe7, SimpleBlock: 0xa3, Block: 0xa1,
} as const;

// Containers whose children are read in place; MediaRecorder leaves Segment and Cluster sizes unknown.
const MASTERS = new Set<number>([ID.Segment, ID.Info, ID.Tracks, ID.TrackEntry, ID.Video, ID.Audio, ID.Cluster, ID.BlockGroup]);
const LEAVES = new Set<number>([
  ID.TimecodeScale, ID.TrackNumber, ID.CodecID, ID.CodecPrivate, ID.PixelWidth, ID.PixelHeight,
  ID.SamplingFrequency, ID.Channels, ID.Timecode, ID.SimpleBlock, ID.Block,
]);

interface Entry { number?: number; codecId?: string; priv?: Uint8Array; width?: number; height?: number; rate?: number; channels?: number }

/** Reads a variable-length integer at `pos`; null when more bytes are needed. Ids keep their marker bit. */
export function readVint(buf: Uint8Array, pos: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } | null {
  if (pos >= buf.length) return null;
  const first = buf[pos]!;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8) throw new Error('Invalid WebM: bad variable-length integer');
  if (pos + length > buf.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === (0xff >> length);
  for (let i = 1; i < length; i++) {
    const b = buf[pos + i]!;
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

const uint = (b: Uint8Array) => b.reduce((n, x) => n * 256 + x, 0);
const float = (b: Uint8Array) => {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return b.length === 4 ? view.getFloat32(0) : view.getFloat64(0);
};
const text = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0+$/, '');
const hex = (n: number) => n.toString(16).padStart(2, '0');

/** WebCodecs config for a Matroska codec id; null when this reader can't hand it to a decoder. */
export function videoTrack(e: Entry): VideoTrack | null {
  const size = { width: e.width ?? 0, height: e.height ?? 0 };
  if (e.codecId === 'V_VP8') return { codec: 'vp8', ...size };
  if (e.codecId === 'V_VP9') return { codec: 'vp09.00.10.08', ...size };
  if (e.codecId === 'V_AV1') return { codec: 'av01.0.08M.08', ...size };
  if (e.codecId === 'V_MPEG4/ISO/AVC' && e.priv && e.priv.length > 3) {
    return { codec: `avc1.${hex(e.priv[1]!)}${hex(e.priv[2]!)}${hex(e.priv[3]!)}`, description: e.priv, ...size };
  }
  return null;
}

export function audioTrack(e: Entry): AudioTrack | null {
  const base = { sampleRate: Math.round(e.rate ?? 48000), channels: e.channels ?? 1 };
  if (e.codecId === 'A_OPUS') return { codec: 'opus', description: e.priv, ...base };
  if (e.codecId === 'A_AAC' || e.codecId?.startsWith('A_AAC/')) return { codec: 'mp4a.40.2', description: e.priv, ...base };
  return null;
}

/** A streaming WebM reader: holds at most one element's bytes plus the unread tail of the last chunk. */
export function createWebmDemuxer(): Demuxer {
  let buf = new Uint8Array(0);
  let skip = 0;
  let scale = 1_000_000; // ns per timecode tick
  let cluster = 0;
  let entry: Entry | null = null;
  const entries: Entry[] = [];
  let tracks: Tracks | null = null;
  let videoNumber = -1;
  let audioNumber = -1;

  function closeTracks() {
    if (tracks) return;
    if (entry) entries.push(entry);
    entry = null;
    tracks = {};
    for (const e of entries) {
      if (e.codecId?.startsWith('V_') && !tracks.video) {
        const v = videoTrack(e);
        if (!v) throw new Error(`Unsupported video codec ${e.codecId}`);
        tracks.video = v;
        videoNumber = e.number ?? -1;
      } else if (e.codecId?.startsWith('A_') && !tracks.audio) {
        const a = audioTrack(e);
        if (!a) throw new Error(`Unsupported audio codec ${e.codecId}`);
        tracks.audio = a;
        audioNumber = e.number ?? -1;
      }
    }
  }

  function block(data: Uint8Array, simple: boolean): Packet | null {
    const num = readVint(data, 0, false);
    if (!num || data.length < num.length + 3) throw new Error('Invalid WebM: short block');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const rel = view.getInt16(num.length);
    const flags = data[num.length + 2]!;
    if (flags & 0x06) throw new Error('Unsupported WebM: laced blocks');
    const track = num.value === videoNumber ? 'video' : num.value === audioNumber ? 'audio' : null;
    if (!track) return null;
    // A Block (inside a BlockGroup) carries no key flag; audio frames are always key.
    const key = simple ? (flags & 0x80) !== 0 : track === 'audio';
    const timestamp = ((cluster + rel) * scale) / 1000;
    return { track, key, timestamp, data: data.slice(num.length + 3) };
  }

  function leaf(id: number, data: Uint8Array, out: Packet[]) {
    switch (id) {
      case ID.TimecodeScale: scale = uint(data); return;
      case ID.Timecode: cluster = uint(data); return;
      case ID.SimpleBlock:
      case ID.Block: {
        closeTracks();
        const p = block(data, id === ID.SimpleBlock);
        if (p) out.push(p);
        return;
      }
    }
    if (!entry) return;
    if (id === ID.TrackNumber) entry.number = uint(data);
    else if (id === ID.CodecID) entry.codecId = text(data);
    else if (id === ID.CodecPrivate) entry.priv = data.slice();
    else if (id === ID.PixelWidth) entry.width = uint(data);
    else if (id === ID.PixelHeight) entry.height = uint(data);
    else if (id === ID.SamplingFrequency) entry.rate = float(data);
    else if (id === ID.Channels) entry.channels = uint(data);
  }

  function parse(): Packet[] {
    const out: Packet[] = [];
    let pos = 0;
    while (pos < buf.length) {
      if (skip > 0) {
        const n = Math.min(skip, buf.length - pos);
        skip -= n;
        pos += n;
        continue;
      }
      const id = readVint(buf, pos, true);
      if (!id) break;
      const size = readVint(buf, pos + id.length, false);
      if (!size) break;
      const head = id.length + size.length;
      if (MASTERS.has(id.value)) {
        if (id.value === ID.TrackEntry && !tracks) {
          if (entry) entries.push(entry);
          entry = {};
        }
        if (id.value === ID.Cluster) closeTracks();
        pos += head;
        continue;
      }
      if (size.unknown) throw new Error('Invalid WebM: element of unknown size');
      if (!LEAVES.has(id.value)) {
        pos += head;
        skip = size.value;
        continue;
      }
      if (pos + head + size.value > buf.length) break;
      leaf(id.value, buf.subarray(pos + head, pos + head + size.value), out);
      pos += head + size.value;
    }
    buf = buf.slice(pos);
    return out;
  }

  return {
    push(bytes) {
      const next = new Uint8Array(buf.length + bytes.length);
      next.set(buf);
      next.set(bytes, buf.length);
      buf = next;
      return parse();
    },
    end() {
      const out = parse();
      closeTracks();
      return out;
    },
    tracks: () => tracks,
  };
}
