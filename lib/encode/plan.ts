import { keptRanges } from '../editList';
import type { KeptRange } from '../types';
import type { Container } from './demux';

/**
 * The kept parts for encoding, in ms. A part that runs to the recorded length runs to the end of the media,
 * since the stored length can fall a few ms short of the last frame.
 */
export function encodePlan(edits: KeptRange[], duration: number): KeptRange[] {
  if (!(duration > 0)) return [{ start: 0, end: Infinity }];
  const kept = keptRanges(edits, duration);
  const last = kept[kept.length - 1];
  if (last && last.end >= duration) last.end = Infinity;
  return kept;
}

/** Edited time in µs for an original time in µs, or null when it falls in a cut. */
export function editedMicros(plan: KeptRange[], us: number): number | null {
  const ms = us / 1000;
  let sum = 0;
  for (const r of plan) {
    if (ms < r.start) return null;
    if (ms < r.end) return (sum + ms - r.start) * 1000;
    sum += r.end - r.start;
  }
  return null;
}

/** Whether a frame at `us` opens a kept part (the encoder starts it with a key frame). */
export function opensPart(plan: KeptRange[], us: number, previousUs: number | null): boolean {
  if (previousUs === null) return true;
  const part = (t: number) => plan.findIndex((r) => t / 1000 >= r.start && t / 1000 < r.end);
  return part(us) !== part(previousUs);
}

export interface AudioSlice { offset: number; count: number; timestamp: number }

/** The kept stretches of one decoded audio buffer: frame offset, frame count and edited timestamp (µs). */
export function audioSlices(plan: KeptRange[], startUs: number, frames: number, sampleRate: number): AudioSlice[] {
  const endUs = startUs + (frames * 1e6) / sampleRate;
  const out: AudioSlice[] = [];
  for (const r of plan) {
    const a = Math.max(startUs, r.start * 1000);
    const b = Math.min(endUs, r.end * 1000);
    if (b <= a) continue;
    const offset = Math.round(((a - startUs) * sampleRate) / 1e6);
    const count = Math.min(frames, Math.round(((b - startUs) * sampleRate) / 1e6)) - offset;
    const timestamp = editedMicros(plan, a);
    if (count > 0 && timestamp !== null) out.push({ offset, count, timestamp });
  }
  return out;
}

/** Bitrate close to the recording's own, in bits per second. */
export function targetBitrate(bytes: number, durationMs: number): number {
  const own = durationMs > 0 ? (bytes * 8) / (durationMs / 1000) : 0;
  return own > 0 ? Math.round(Math.min(16e6, Math.max(1e6, own))) : 5e6;
}

/** A key frame at least this often, so the copy seeks well. */
export const KEY_FRAME_EVERY_US = 2_000_000;

/** Encoder codecs to try for each output container, best first, with the muxer's name for each. */
export const VIDEO_CODECS: Record<Container, { codec: string; mux: string }[]> = {
  mp4: [
    { codec: 'avc1.640034', mux: 'avc' }, { codec: 'avc1.4d0034', mux: 'avc' }, { codec: 'avc1.42e034', mux: 'avc' },
    { codec: 'avc1.640028', mux: 'avc' }, { codec: 'avc1.42e01f', mux: 'avc' }, { codec: 'vp09.00.40.08', mux: 'vp9' },
  ],
  webm: [{ codec: 'vp09.00.40.08', mux: 'V_VP9' }, { codec: 'vp8', mux: 'V_VP8' }],
};
export const AUDIO_CODECS: Record<Container, { codec: string; mux: string }[]> = {
  mp4: [{ codec: 'mp4a.40.2', mux: 'aac' }, { codec: 'opus', mux: 'opus' }],
  webm: [{ codec: 'opus', mux: 'A_OPUS' }],
};

/** Saving goes through the encoder for cuts or another container; otherwise the stored file is copied. */
export const needsEncode = (cut: boolean, from: Container, to: Container): boolean => cut || from !== to;
