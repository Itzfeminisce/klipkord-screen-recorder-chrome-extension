import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import { editedLength } from '../editList';
import type { Recording } from '../types';
import { videoStore } from '../videoStore';
import { sniff, type AudioTrack, type Container, type Demuxer, type Packet, type Tracks, type VideoTrack } from './demux';
import { createMp4Demuxer } from './mp4';
import { AUDIO_CODECS, KEY_FRAME_EVERY_US, VIDEO_CODECS, audioSlices, editedMicros, encodePlan, opensPart, targetBitrate } from './plan';
import { createWebmDemuxer } from './webm';

export { needsEncode } from './plan';

const CHUNK_BYTES = 2 * 1024 * 1024;
// Few frames wait in either queue, so memory stays flat however long the recording is.
const MAX_QUEUE = 6;

export interface EncodeDeps { read: (rec: Recording) => Promise<Blob> }
const defaultDeps: EncodeDeps = { read: (rec) => videoStore.read(rec.id, 'video', rec.mime) };

const aborted = () => new DOMException('The export was stopped', 'AbortError');

async function firstSupported<C extends VideoEncoderConfig | AudioEncoderConfig>(
  options: { codec: string; mux: string }[], make: (codec: string) => C, check: (c: C) => Promise<{ supported?: boolean }>,
): Promise<{ config: C; mux: string } | null> {
  for (const o of options) {
    const config = make(o.codec);
    try { if ((await check(config)).supported) return { config, mux: o.mux }; } catch { /* try the next codec */ }
  }
  return null;
}

/**
 * Re-encodes only the kept parts of a recording into a new MP4 or WebM (`to`, by default the original's container).
 * Frames stream from the stored file through WebCodecs one by one; the original is never changed.
 */
export async function encodeKept(
  rec: Recording, onProgress: (share: number) => void, signal?: AbortSignal, to?: Container, deps: EncodeDeps = defaultDeps,
): Promise<Blob> {
  if (signal?.aborted) throw aborted();
  const source = await deps.read(rec);
  if (source.size === 0) throw new Error('The recording has no video');
  const sniffed = sniff(new Uint8Array(await source.slice(0, 16).arrayBuffer()));
  if (!sniffed) throw new Error('The recording is not an MP4 or WebM file');
  const demuxer: Demuxer = sniffed === 'mp4' ? createMp4Demuxer() : createWebmDemuxer();
  const container: Container = to ?? sniffed;

  const plan = encodePlan(rec.edits, rec.duration);
  const totalUs = Math.max(1, (rec.duration > 0 ? editedLength(rec.edits, rec.duration) : 1) * 1000);
  let failure: unknown = null;
  const fail = (error: unknown) => { failure ??= error; };

  let muxer = null as Mp4Muxer<Mp4Target> | WebmMuxer<WebmTarget> | null;
  let vdec = null as VideoDecoder | null;
  let venc = null as VideoEncoder | null;
  let adec = null as AudioDecoder | null;
  let aenc = null as AudioEncoder | null;
  let lastFrameUs: number | null = null;
  let lastKeyUs = -Infinity;

  function onFrame(frame: VideoFrame) {
    const at = editedMicros(plan, frame.timestamp);
    if (at === null || !venc || failure) { frame.close(); return; }
    const key = opensPart(plan, frame.timestamp, lastFrameUs) || at - lastKeyUs >= KEY_FRAME_EVERY_US;
    lastFrameUs = frame.timestamp;
    if (key) lastKeyUs = at;
    const out = new VideoFrame(frame, { timestamp: Math.round(at) });
    frame.close();
    venc.encode(out, { keyFrame: key });
    out.close();
    onProgress(Math.min(1, at / totalUs));
  }

  function onAudio(data: AudioData) {
    try {
      if (!aenc || failure) return;
      const channels = data.numberOfChannels;
      for (const s of audioSlices(plan, data.timestamp, data.numberOfFrames, data.sampleRate)) {
        const samples = new Float32Array(s.count * channels);
        for (let c = 0; c < channels; c++) {
          data.copyTo(samples.subarray(c * s.count, (c + 1) * s.count), { planeIndex: c, frameOffset: s.offset, frameCount: s.count, format: 'f32-planar' });
        }
        const part = new AudioData({ format: 'f32-planar', sampleRate: data.sampleRate, numberOfFrames: s.count, numberOfChannels: channels, timestamp: Math.round(s.timestamp), data: samples });
        aenc.encode(part);
        part.close();
      }
    } catch (error) {
      fail(error);
    } finally {
      data.close();
    }
  }

  async function setUp(tracks: Tracks) {
    const v: VideoTrack | undefined = tracks.video;
    if (!v) throw new Error('The recording has no video track');
    const vin: VideoDecoderConfig = { codec: v.codec, description: v.description, codedWidth: v.width, codedHeight: v.height };
    if (!(await VideoDecoder.isConfigSupported(vin)).supported) throw new Error(`This browser can't decode ${v.codec}`);
    const vout = await firstSupported(VIDEO_CODECS[container], (codec) => ({
      codec, width: v.width, height: v.height, bitrate: targetBitrate(rec.bytes, rec.duration), framerate: 30, latencyMode: 'quality',
      ...(codec.startsWith('avc1') ? { avc: { format: 'avc' } } : {}),
    } as VideoEncoderConfig), (c) => VideoEncoder.isConfigSupported(c));
    if (!vout) throw new Error("This browser can't encode video for the copy");

    const a: AudioTrack | undefined = tracks.audio;
    let ain: AudioDecoderConfig | null = null;
    let aout: { config: AudioEncoderConfig; mux: string } | null = null;
    if (a) {
      ain = { codec: a.codec, description: a.description, sampleRate: a.sampleRate, numberOfChannels: a.channels };
      if (!(await AudioDecoder.isConfigSupported(ain)).supported) throw new Error(`This browser can't decode ${a.codec}`);
      aout = await firstSupported(AUDIO_CODECS[container], (codec) => ({ codec, sampleRate: a.sampleRate, numberOfChannels: a.channels, bitrate: 128_000 }),
        (c) => AudioEncoder.isConfigSupported(c));
      if (!aout) throw new Error("This browser can't encode audio for the copy");
    }

    const audio = a && aout ? { codec: aout.mux, numberOfChannels: a.channels, sampleRate: a.sampleRate } : undefined;
    muxer = container === 'mp4'
      ? new Mp4Muxer({
        target: new Mp4Target(), fastStart: 'in-memory', firstTimestampBehavior: 'cross-track-offset',
        video: { codec: vout.mux as 'avc' | 'vp9', width: v.width, height: v.height },
        audio: audio as { codec: 'aac' | 'opus'; numberOfChannels: number; sampleRate: number } | undefined,
      })
      : new WebmMuxer({ target: new WebmTarget(), firstTimestampBehavior: 'permissive', video: { codec: vout.mux, width: v.width, height: v.height }, audio });
    const mux = muxer;

    venc = new VideoEncoder({ output: (chunk, meta) => { try { mux.addVideoChunk(chunk, meta); } catch (error) { fail(error); } }, error: fail });
    venc.configure(vout.config);
    vdec = new VideoDecoder({ output: onFrame, error: fail });
    vdec.configure(vin);
    if (ain && aout) {
      aenc = new AudioEncoder({ output: (chunk, meta) => { try { mux.addAudioChunk(chunk, meta); } catch (error) { fail(error); } }, error: fail });
      aenc.configure(aout.config);
      adec = new AudioDecoder({ output: onAudio, error: fail });
      adec.configure(ain);
    }
  }

  const busy = () => (vdec?.decodeQueueSize ?? 0) > MAX_QUEUE || (venc?.encodeQueueSize ?? 0) > MAX_QUEUE
    || (adec?.decodeQueueSize ?? 0) > MAX_QUEUE * 4 || (aenc?.encodeQueueSize ?? 0) > MAX_QUEUE * 4;
  const check = () => {
    if (signal?.aborted) throw aborted();
    if (failure) throw failure;
  };

  let seenKey = false;
  async function feed(packets: Packet[]) {
    for (const p of packets) {
      check();
      if (p.track === 'video') {
        // Decoding has to begin on a key frame.
        if (!seenKey && !p.key) continue;
        seenKey = true;
        vdec?.decode(new EncodedVideoChunk({ type: p.key ? 'key' : 'delta', timestamp: Math.round(p.timestamp), duration: p.duration, data: p.data }));
      } else {
        adec?.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(p.timestamp), duration: p.duration, data: p.data }));
      }
      while (busy()) {
        check();
        await new Promise((resolve) => setTimeout(resolve, 4));
      }
    }
  }

  async function handle(packets: Packet[]) {
    if (!muxer) {
      const tracks = demuxer.tracks();
      if (!tracks) return;
      await setUp(tracks);
    }
    await feed(packets);
  }

  const close = () => {
    for (const c of [vdec, venc, adec, aenc]) if (c && c.state !== 'closed') c.close();
  };

  // Closing the codecs makes a pending flush reject at once.
  const onAbort = () => { fail(aborted()); close(); };
  signal?.addEventListener('abort', onAbort);
  try {
    for (let at = 0; at < source.size; at += CHUNK_BYTES) {
      check();
      const bytes = new Uint8Array(await source.slice(at, at + CHUNK_BYTES).arrayBuffer());
      await handle(demuxer.push(bytes));
    }
    await handle(demuxer.end());
    if (!muxer) throw new Error('The recording has no readable tracks');
    check();
    try {
      await vdec?.flush();
      await adec?.flush();
      await venc?.flush();
      await aenc?.flush();
    } catch (error) {
      fail(error);
    }
    check();
    const done = muxer as Mp4Muxer<Mp4Target> | WebmMuxer<WebmTarget>;
    done.finalize();
    onProgress(1);
    return new Blob([done.target.buffer], { type: container === 'mp4' ? 'video/mp4' : 'video/webm' });
  } finally {
    signal?.removeEventListener('abort', onAbort);
    close();
  }
}
