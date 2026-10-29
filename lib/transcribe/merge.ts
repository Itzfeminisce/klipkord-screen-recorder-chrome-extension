import type { Segment, Word } from '@/lib/types';

/** One chunk's result. Word times are ms from the start of the chunk. */
export interface Heard { text: string; words?: Word[] }

// What Whisper writes for silence or noise; never shown as speech.
const NOISE = /^[\s.,…-]*$|^\s*[[(][^\])]*[\])]\s*$/;

/** Cleans one model output; empty string when it holds no speech. */
export function cleanText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return NOISE.test(t) ? '' : t;
}

const words = (s: string) => s.split(' ').filter(Boolean);
const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/** How many words at the start of `next` repeat the end of `prev`. */
function overlap(prev: string[], next: string[], max = 6): number {
  const a = prev.map(norm);
  for (let n = Math.min(max, a.length, next.length); n > 0; n--) {
    if (a.slice(-n).join(' ') === next.slice(0, n).map(norm).join(' ')) return n;
  }
  return 0;
}

/** Drops words at the start of `next` that repeat the end of `prev` (a word cut across a chunk boundary). */
export function trimOverlap(prev: string, next: string, max = 6): string {
  const b = words(next);
  return b.slice(overlap(words(prev), b, max)).join(' ');
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A chunk's result on the recording's timeline: words shifted by the chunk start, kept inside it and in order. */
export function toSegment(start: number, end: number, heard: string | Heard): Segment {
  if (typeof heard === 'string') return { start, end, text: heard };
  if (!heard.words) return { start, end, text: heard.text };
  let last = start;
  const placed = heard.words.flatMap((w) => {
    const text = w.text.trim();
    if (!text || NOISE.test(text)) return [];
    const s = clamp(start + w.start, last, end);
    last = s;
    return [{ start: s, end: clamp(start + w.end, s, end), text }];
  });
  return { start, end, text: heard.text, words: placed };
}

/** Adds a segment in time order; empty or repeated text is dropped. With words, the text is rebuilt from them. */
export function appendSegment(list: Segment[], seg: Segment): Segment[] {
  const prev = [...list].reverse().find((s) => s.end <= seg.start + 1);
  if (seg.words?.length) {
    const before = prev ? (prev.words?.map((w) => w.text) ?? words(prev.text)) : [];
    const kept = seg.words.slice(overlap(before, seg.words.map((w) => w.text)));
    const text = cleanText(kept.map((w) => w.text).join(' '));
    if (!text) return list;
    return [...list, { ...seg, text, words: kept }].sort((x, y) => x.start - y.start);
  }
  const { words: _none, ...plain } = seg;
  const text = cleanText(prev ? trimOverlap(prev.text, cleanText(seg.text)) : seg.text);
  if (!text) return list;
  return [...list, { ...plain, text }].sort((x, y) => x.start - y.start);
}

/** Builds a transcript from chunk results in any order. */
export function mergeSegments(segs: Segment[]): Segment[] {
  return [...segs].sort((x, y) => x.start - y.start).reduce<Segment[]>(appendSegment, []);
}

/** The base pass replaces the live text, unless it found nothing (then the live text stays). */
export function replaceTranscript(live: Segment[], base: Segment[]): Segment[] {
  return base.some((s) => s.text) ? base : live;
}

/** True when every segment carries word times. */
export function hasWords(segs: Segment[]): boolean {
  return segs.every((s) => s.words?.length);
}

export function wordCount(segs: Segment[]): number {
  return segs.reduce((n, s) => n + words(s.text).length, 0);
}
