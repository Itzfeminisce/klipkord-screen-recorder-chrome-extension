import { cut, keptRanges, normalize } from './editList';
import type { KeptRange, Segment, Word } from './types';

/** One selectable piece of a line: its words, or the whole line when it has no word timings. */
export interface Unit extends Word { line: number }

/** Every selectable unit of a transcript, in order. */
export function units(segments: Segment[]): Unit[] {
  return segments.flatMap((s, line) =>
    s.words?.length ? s.words.map((w) => ({ ...w, line })) : [{ start: s.start, end: s.end, text: s.text, line }]);
}

/** A unit is cut when the edited video no longer plays its middle. */
export function isCut(edits: KeptRange[], duration: number, w: Word): boolean {
  const mid = (w.start + w.end) / 2;
  return !keptRanges(edits, duration).some((r) => mid >= r.start && mid < r.end);
}

/** The time ranges that cover the chosen units; neighbours merge so the gap between them goes too. */
export function wordsToRanges(words: Word[], chosen: ReadonlySet<number>): KeptRange[] {
  const out: KeptRange[] = [];
  let open: KeptRange | null = null;
  for (const [i, w] of words.entries()) {
    if (!chosen.has(i)) open = null;
    else if (open) open.end = Math.max(open.end, w.end);
    else { open = { start: w.start, end: w.end }; out.push(open); }
  }
  return out.filter((r) => r.end > r.start);
}

/** Cuts the chosen units, joining them to neighbours that are already cut. */
export function deleteWords(edits: KeptRange[], duration: number, words: Word[], chosen: ReadonlySet<number>): KeptRange[] {
  if (chosen.size === 0) return normalize(edits, duration);
  const all = new Set(chosen);
  words.forEach((w, i) => { if (isCut(edits, duration, w)) all.add(i); });
  return wordsToRanges(words, all).reduce((list, r) => cut(list, duration, r.start, r.end), edits);
}

/** Gives back units `from`..`to` (inclusive), the gaps between them and the gaps to kept neighbours. */
export function restoreWords(edits: KeptRange[], duration: number, words: Word[], from: number, to: number): KeptRange[] {
  const first = words[from];
  const last = words[to];
  if (!first || !last) return normalize(edits, duration);
  const before = words[from - 1];
  const after = words[to + 1];
  const start = before && !isCut(edits, duration, before) ? Math.min(first.start, before.end) : first.start;
  const end = after && !isCut(edits, duration, after) ? Math.max(last.end, after.start) : last.end;
  return normalize([...keptRanges(edits, duration), { start, end }], duration);
}

/** Number of spoken words in the chosen units; a whole line counts each of its words. */
export function wordCount(words: Word[], chosen: Iterable<number>): number {
  let n = 0;
  for (const i of chosen) n += words[i]?.text.split(/\s+/).filter(Boolean).length ?? 0;
  return n;
}
