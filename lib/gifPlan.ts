import { editedLength, toOriginal } from './editList';
import type { KeptRange } from './types';

export const GIF_MAX_MS = 15_000;
export const GIF_WIDTH = 640;
export const GIF_FPS = 12;
/** GIF delays are whole hundredths of a second: 80 ms is the 12 fps step (12.5 played), as T0 measured. */
export const GIF_DELAY_MS = 80;
// T0: 15 s at 640x360 and 80 ms came to 3.4 MB in 188 frames.
const BYTES_PER_FRAME = 3_400_000 / 188;

export interface GifRange { start: number; end: number }
export type GifRangeCheck = 'ok' | 'empty' | 'gif-too-long';

/** Start and end are ms on the edited video. */
export function checkRange(range: GifRange): GifRangeCheck {
  const length = range.end - range.start;
  if (!(length >= GIF_DELAY_MS)) return 'empty';
  return length > GIF_MAX_MS ? 'gif-too-long' : 'ok';
}

export function frameCount(range: GifRange): number {
  return Math.max(0, Math.floor((range.end - range.start) / GIF_DELAY_MS));
}

/** Original-video times to draw: one per frame along the edited timeline, so cuts are skipped. */
export function frameTimes(edits: KeptRange[], duration: number, range: GifRange): number[] {
  const total = editedLength(edits, duration);
  const start = Math.max(0, range.start);
  const end = Math.min(total, range.end);
  const times: number[] = [];
  for (let at = start; at + GIF_DELAY_MS <= end; at += GIF_DELAY_MS) times.push(toOriginal(edits, duration, at));
  return times;
}

/** Even height for the recording's shape at the GIF width. */
export function gifHeight(videoWidth: number, videoHeight: number, width = GIF_WIDTH): number {
  const aspect = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
  return Math.max(2, Math.round(width / aspect / 2) * 2);
}

/** Rough file size; the real one depends on how busy the screen is. */
export function estimateGifBytes(range: GifRange, width = GIF_WIDTH, height = 360): number {
  return Math.round(frameCount(range) * BYTES_PER_FRAME * ((width * height) / (GIF_WIDTH * 360)));
}

/** File name: the title as a slug plus the clip's start as mmss, e.g. `checkout-freezes-0042.gif`. */
export function gifFileName(title: string, startMs: number): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'klipkord';
  const s = Math.floor(Math.max(0, startMs) / 1000);
  const mmss = `${String(Math.floor(s / 60)).padStart(2, '0')}${String(s % 60).padStart(2, '0')}`;
  return `${slug}-${mmss}.gif`;
}
