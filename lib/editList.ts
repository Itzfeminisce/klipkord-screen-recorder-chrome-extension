import type { KeptRange } from './types';

/** One line in the Trim list: a trimmed start, a cut part or a trimmed end (ms, original time). */
export type Edit =
  | { kind: 'start'; at: number }
  | { kind: 'cut'; from: number; to: number }
  | { kind: 'end'; at: number };

/** Shorter kept parts than this are dropped: a cut never leaves a sliver behind. */
export const MIN_KEPT_MS = 100;

const clamp = (ms: number, duration: number) => Math.min(duration, Math.max(0, Number.isFinite(ms) ? ms : 0));

/** The kept parts as the explicit list: sorted, clipped to the video, overlaps merged, slivers dropped. */
export function keptRanges(edits: KeptRange[], duration: number): KeptRange[] {
  if (edits.length === 0) return duration > 0 ? [{ start: 0, end: duration }] : [];
  return merge(edits, duration);
}

// Unlike keptRanges, an empty result here means nothing is kept.
function merge(edits: KeptRange[], duration: number): KeptRange[] {
  const sorted = edits
    .map((r) => ({ start: clamp(r.start, duration), end: clamp(r.end, duration) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const out: KeptRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out.filter((r) => r.end - r.start >= MIN_KEPT_MS);
}

/** The stored form: the whole video is the empty list. */
export function normalize(edits: KeptRange[], duration: number): KeptRange[] {
  const kept = keptRanges(edits, duration);
  const whole = kept.length === 1 && kept[0]!.start === 0 && kept[0]!.end === duration;
  return whole ? [] : kept;
}

/** Length of the edited video. */
export function editedLength(edits: KeptRange[], duration: number): number {
  return keptRanges(edits, duration).reduce((sum, r) => sum + r.end - r.start, 0);
}

/** Removes `from`..`to` from the kept parts. Returns the edits unchanged when nothing would be left. */
export function cut(edits: KeptRange[], duration: number, from: number, to: number): KeptRange[] {
  const a = clamp(Math.min(from, to), duration);
  const b = clamp(Math.max(from, to), duration);
  if (b <= a) return normalize(edits, duration);
  const out: KeptRange[] = [];
  for (const r of keptRanges(edits, duration)) {
    if (r.end <= a || r.start >= b) out.push(r);
    else {
      if (r.start < a) out.push({ start: r.start, end: a });
      if (r.end > b) out.push({ start: b, end: r.end });
    }
  }
  return merge(out, duration).length === 0 ? normalize(edits, duration) : normalize(out, duration);
}

/** The video now starts at `ms`. */
export function setStart(edits: KeptRange[], duration: number, ms: number): KeptRange[] {
  const kept = keptRanges(edits, duration);
  const first = kept[0];
  if (!first) return [];
  const at = clamp(ms, duration);
  // Moving the start earlier gives back the trimmed start; later cuts everything before it.
  return at < first.start ? normalize([{ start: at, end: first.end }, ...kept.slice(1)], duration) : cut(kept, duration, 0, at);
}

/** The video now ends at `ms`. */
export function setEnd(edits: KeptRange[], duration: number, ms: number): KeptRange[] {
  const kept = keptRanges(edits, duration);
  const last = kept[kept.length - 1];
  if (!last) return [];
  const at = clamp(ms, duration);
  return at > last.end ? normalize([...kept.slice(0, -1), { start: last.start, end: at }], duration) : cut(kept, duration, at, duration);
}

/** The Trim list, first to last on the timeline. */
export function describe(edits: KeptRange[], duration: number): Edit[] {
  const kept = keptRanges(edits, duration);
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (!first || !last) return [];
  const out: Edit[] = [];
  if (first.start > 0) out.push({ kind: 'start', at: first.start });
  for (let i = 1; i < kept.length; i++) out.push({ kind: 'cut', from: kept[i - 1]!.end, to: kept[i]!.start });
  if (last.end < duration) out.push({ kind: 'end', at: last.end });
  return out;
}

/** Undoes one edit from `describe`, keeping the others. */
export function restore(edits: KeptRange[], duration: number, edit: Edit): KeptRange[] {
  const kept = keptRanges(edits, duration);
  if (kept.length === 0) return [];
  if (edit.kind === 'start') return normalize([{ start: 0, end: kept[0]!.end }, ...kept.slice(1)], duration);
  if (edit.kind === 'end') return normalize([...kept.slice(0, -1), { start: kept[kept.length - 1]!.start, end: duration }], duration);
  return normalize([...kept, { start: edit.from, end: edit.to }], duration);
}

/** Original time → edited time. A time inside a cut maps to where the next kept part begins. */
export function toEdited(edits: KeptRange[], duration: number, ms: number): number {
  let sum = 0;
  for (const r of keptRanges(edits, duration)) {
    if (ms < r.start) return sum;
    if (ms < r.end) return sum + ms - r.start;
    sum += r.end - r.start;
  }
  return sum;
}

/** Edited time → original time. */
export function toOriginal(edits: KeptRange[], duration: number, ms: number): number {
  const kept = keptRanges(edits, duration);
  let left = Math.max(0, ms);
  for (const r of kept) {
    const len = r.end - r.start;
    if (left < len) return r.start + left;
    left -= len;
  }
  return kept[kept.length - 1]?.end ?? 0;
}

/**
 * Where playback belongs for an original time: the time itself when it is kept, the start of the next kept part
 * inside a cut, or the end of the last kept part past it (`ended`).
 */
export function playable(edits: KeptRange[], duration: number, ms: number): { at: number; ended: boolean } {
  if (edits.length === 0) return { at: ms, ended: false };
  const kept = keptRanges(edits, duration);
  for (const r of kept) {
    if (ms < r.start) return { at: r.start, ended: false };
    if (ms < r.end) return { at: ms, ended: false };
  }
  return { at: kept[kept.length - 1]?.end ?? ms, ended: true };
}

/** The kept part, if any, that holds an original time in microseconds; used per frame while encoding. */
export function rangeAtMicros(kept: KeptRange[], us: number): KeptRange | undefined {
  const ms = us / 1000;
  return kept.find((r) => ms >= r.start && ms < r.end);
}
