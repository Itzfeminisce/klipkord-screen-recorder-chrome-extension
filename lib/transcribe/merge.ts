import type { Segment } from '@/lib/types';

// What Whisper writes for silence or noise; never shown as speech.
const NOISE = /^[\s.,…-]*$|^\s*[[(][^\])]*[\])]\s*$/;

/** Cleans one model output; empty string when it holds no speech. */
export function cleanText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return NOISE.test(t) ? '' : t;
}

const words = (s: string) => s.split(' ').filter(Boolean);
const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/** Drops words at the start of `next` that repeat the end of `prev` (a word cut across a chunk boundary). */
export function trimOverlap(prev: string, next: string, max = 6): string {
  const a = words(prev).map(norm);
  const b = words(next);
  for (let n = Math.min(max, a.length, b.length); n > 0; n--) {
    if (a.slice(-n).join(' ') === b.slice(0, n).map(norm).join(' ')) return b.slice(n).join(' ');
  }
  return next;
}

/** Adds a segment in time order; empty or repeated text is dropped. */
export function appendSegment(list: Segment[], seg: Segment): Segment[] {
  const prev = [...list].reverse().find((s) => s.end <= seg.start + 1);
  const text = cleanText(prev ? trimOverlap(prev.text, cleanText(seg.text)) : seg.text);
  if (!text) return list;
  return [...list, { ...seg, text }].sort((x, y) => x.start - y.start);
}

/** Builds a transcript from chunk results in any order. */
export function mergeSegments(segs: Segment[]): Segment[] {
  return [...segs].sort((x, y) => x.start - y.start).reduce<Segment[]>(appendSegment, []);
}

/** The base pass replaces the live text, unless it found nothing (then the live text stays). */
export function replaceTranscript(live: Segment[], base: Segment[]): Segment[] {
  return base.some((s) => s.text) ? base : live;
}

export function wordCount(segs: Segment[]): number {
  return segs.reduce((n, s) => n + words(s.text).length, 0);
}
