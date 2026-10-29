import { DataStream, Endianness, MP4BoxBuffer, createFile, type AudioSampleEntry, type MultiBufferStream, type Track, type VisualSampleEntry } from 'mp4box';
import type { AudioTrack, Demuxer, Packet, Tracks, VideoTrack } from './demux';

const BATCH = 64;

// fromArrayBuffer copies, so a view that spans its whole buffer is passed as is.
const whole = (b: Uint8Array) => (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.slice().buffer);

/** A streaming MP4 reader on mp4box: samples are handed out and released as soon as each chunk is parsed. */
export function createMp4Demuxer(): Demuxer {
  const file = createFile();
  let tracks: Tracks | null = null;
  let fileStart = 0;
  let pending: Packet[] = [];
  let failure: Error | null = null;
  const kinds = new Map<number, 'video' | 'audio'>();

  function entryOf(track: Track) {
    return file.getTrackById(track.id).mdia.minf.stbl.stsd.entries[0];
  }

  function video(track: Track): VideoTrack {
    const entry = entryOf(track) as VisualSampleEntry;
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    let description: Uint8Array | undefined;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      // write() only uses DataStream methods; the type asks for the parser's stream.
      box.write(stream as unknown as MultiBufferStream);
      description = new Uint8Array(stream.buffer, 8); // past the box header
    }
    return { codec: track.codec, description, width: track.video?.width ?? entry.width, height: track.video?.height ?? entry.height };
  }

  function audio(track: Track): AudioTrack {
    const entry = entryOf(track) as AudioSampleEntry & { esds?: { esd: { findDescriptor(tag: number): { findDescriptor(tag: number): { data: Uint8Array } | undefined } | undefined } } };
    const description = entry.esds?.esd.findDescriptor(4)?.findDescriptor(5)?.data;
    const codec = track.codec.toLowerCase() === 'opus' ? 'opus' : track.codec;
    return { codec, description, sampleRate: track.audio?.sample_rate ?? entry.samplerate, channels: track.audio?.channel_count ?? entry.channel_count };
  }

  file.onError = (_module: string, message: string) => { failure = new Error(`Invalid MP4: ${message}`); };
  file.onReady = (info) => {
    tracks = {};
    const v = info.videoTracks[0];
    const a = info.audioTracks[0];
    if (v) { tracks.video = video(v); kinds.set(v.id, 'video'); file.setExtractionOptions(v.id, undefined, { nbSamples: BATCH }); }
    if (a) { tracks.audio = audio(a); kinds.set(a.id, 'audio'); file.setExtractionOptions(a.id, undefined, { nbSamples: BATCH }); }
    file.start();
  };
  file.onSamples = (id, _user, samples) => {
    const track = kinds.get(id);
    if (!track) return;
    for (const s of samples) {
      if (!s.data) continue;
      pending.push({ track, key: s.is_sync, timestamp: (s.cts * 1e6) / s.timescale, duration: (s.duration * 1e6) / s.timescale, data: s.data });
    }
    const last = samples[samples.length - 1];
    if (last) file.releaseUsedSamples(id, last.number + 1);
  };

  function take(): Packet[] {
    if (failure) throw failure;
    const out = pending;
    pending = [];
    return out;
  }

  return {
    push(bytes) {
      const buffer = MP4BoxBuffer.fromArrayBuffer(whole(bytes), fileStart);
      fileStart += bytes.byteLength;
      file.appendBuffer(buffer);
      return take();
    },
    end() {
      file.flush();
      return take();
    },
    tracks: () => tracks,
  };
}
