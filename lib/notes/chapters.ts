import type { Chapter, Segment } from '../types';

/** A time may sit this far outside the nearest spoken segment and still be believed. */
export const TIME_TOLERANCE_MS = 15_000;
/** Chapters closer together than this are one chapter. */
export const MIN_CHAPTER_GAP_MS = 5_000;

/** "03:48", "1:02:03", or a bare number of seconds → ms. Null when it is not a time. */
export function parseClock(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : null;
  if (typeof value !== 'string') return null;
  const parts = value.trim().replace(/^\[|\]$/g, '').split(':');
  if (parts.length < 1 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const seconds = parts.reduce((total, p) => total * 60 + Number(p), 0);
  return Math.round(seconds * 1000);
}

/** The time if the transcript backs it, clamped into the nearest spoken segment; null if it does not. */
export function checkTime(at: number, segments: Segment[], durationMs: number): number | null {
  if (!Number.isFinite(at) || at < 0 || at > durationMs + TIME_TOLERANCE_MS) return null;
  let best: Segment | null = null;
  let bestGap = Infinity;
  for (const s of segments) {
    const gap = at < s.start ? s.start - at : at > s.end ? at - s.end : 0;
    if (gap < bestGap) { best = s; bestGap = gap; }
  }
  if (!best || bestGap > TIME_TOLERANCE_MS) return null;
  return Math.min(Math.max(at, best.start), best.end, durationMs);
}

/** Keeps only chapters whose time and title hold up; sorted, with near-duplicates merged. */
export function checkChapters(raw: unknown, segments: Segment[], durationMs: number): Chapter[] {
  if (!Array.isArray(raw)) return [];
  const found: Chapter[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { at, title } = item as { at?: unknown; title?: unknown };
    const ms = parseClock(at);
    if (ms === null || typeof title !== 'string' || !title.trim()) continue;
    const checked = checkTime(ms, segments, durationMs);
    if (checked !== null) found.push({ at: checked, title: title.trim() });
  }
  found.sort((a, b) => a.at - b.at);
  return found.filter((c, i) => i === 0 || c.at - (found[i - 1]?.at ?? 0) >= MIN_CHAPTER_GAP_MS);
}

/** Notes.sections holds plain strings; a timed step is "<ms>\t<text>". */
export const encodeTimed = (at: number, text: string): string => `${at}\t${text}`;

export function decodeTimed(line: string): { at?: number; text: string } {
  const tab = line.indexOf('\t');
  const at = tab > 0 ? Number(line.slice(0, tab)) : NaN;
  return Number.isFinite(at) ? { at, text: line.slice(tab + 1) } : { text: line };
}

/** Timed steps from model output ({at, text} or plain strings); an unbacked time is dropped, the text is kept. */
export function checkTimedLines(raw: unknown, segments: Segment[], durationMs: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): string[] => {
    if (typeof item === 'string') return item.trim() ? [item.trim()] : [];
    if (!item || typeof item !== 'object') return [];
    const { at, text } = item as { at?: unknown; text?: unknown };
    if (typeof text !== 'string' || !text.trim()) return [];
    const ms = parseClock(at);
    const checked = ms === null ? null : checkTime(ms, segments, durationMs);
    return [checked === null ? text.trim() : encodeTimed(checked, text.trim())];
  });
}
