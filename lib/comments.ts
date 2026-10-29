import { updateRecording } from './db';
import type { Comment, KeptRange, Marker, Recording, Segment, TimedNote } from './types';

/** Open comments first-to-last on the timeline; ties keep the order they were written. */
export function sortComments(list: Comment[]): Comment[] {
  return [...list].sort((a, b) => a.at - b.at || a.createdAt - b.createdAt);
}

export function splitComments(list: Comment[]): { open: Comment[]; resolved: Comment[] } {
  const sorted = sortComments(list);
  return { open: sorted.filter((c) => !c.resolved), resolved: sorted.filter((c) => c.resolved) };
}

/** "1 resolved", "3 resolved". */
export const resolvedLabel = (count: number) => `${count} resolved`;

export function newComment(at: number, text: string, id: string, now: number): Comment | null {
  const clean = text.trim();
  return clean ? { id, at: Math.max(0, Math.round(at)), text: clean, resolved: false, createdAt: now } : null;
}

/** Edits the text of one comment; blank text leaves it as it was. */
export function editComment(list: Comment[], id: string, text: string): Comment[] {
  const clean = text.trim();
  return clean ? list.map((c) => (c.id === id ? { ...c, text: clean } : c)) : list;
}

export const resolveComment = (list: Comment[], id: string): Comment[] => list.map((c) => (c.id === id ? { ...c, resolved: true } : c));

/** Saves comments onto the latest copy of the recording, so a notes job writing at the same time is not undone. */
export async function saveComments(recordingId: string, comments: Comment[]): Promise<Recording | null> {
  return (await updateRecording(recordingId, { comments })) ?? null;
}

/** Index of the line being spoken at `ms`: the last segment that started. -1 before the first. */
export function currentLine(segments: Segment[], ms: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((segments[mid]?.start ?? Infinity) <= ms) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

export type TranscriptItem =
  | { kind: 'line'; at: number; index: number; segment: Segment }
  | { kind: 'marker'; at: number; marker: Marker }
  | { kind: 'note'; at: number; note: TimedNote };

const ORDER = { line: 0, marker: 1, note: 2 } as const;

/** Spoken lines with markers and timed notes between them, in time order. */
export function transcriptItems(segments: Segment[], markers: Marker[], notes: TimedNote[]): TranscriptItem[] {
  const items: TranscriptItem[] = [
    ...segments.map((segment, index): TranscriptItem => ({ kind: 'line', at: segment.start, index, segment })),
    ...markers.map((marker): TranscriptItem => ({ kind: 'marker', at: marker.at, marker })),
    ...notes.map((note): TranscriptItem => ({ kind: 'note', at: note.at, note })),
  ];
  return items.sort((a, b) => a.at - b.at || ORDER[a.kind] - ORDER[b.kind]);
}

export const transcriptText = (segments: Segment[], clock: (ms: number) => string) =>
  segments.map((s) => `${clock(s.start)} ${s.text}`).join('\n');

/** The kept parts, sorted and clipped; an empty list means the whole video. */
function kept(edits: KeptRange[]): KeptRange[] {
  return edits.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
}

/**
 * Where to play for a recording time. With no edits it is the time itself.
 * Inside a cut part it moves to the start of the next kept part; past the last one it stays at its end.
 */
export function mapTime(edits: KeptRange[], ms: number): number {
  const ranges = kept(edits);
  if (ranges.length === 0) return ms;
  for (const r of ranges) {
    if (ms < r.start) return r.start;
    if (ms < r.end) return ms;
  }
  return ranges[ranges.length - 1]?.end ?? ms;
}

/** Length of the video once the cut parts are gone. */
export function keptLength(edits: KeptRange[], duration: number): number {
  const ranges = kept(edits);
  return ranges.length === 0 ? duration : ranges.reduce((sum, r) => sum + (Math.min(r.end, duration) - Math.min(r.start, duration)), 0);
}

/** Length shown under the title: 252000 → "4:12". */
export function formatLength(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Share of the timeline for a time, 0 to 100. */
export function percentOf(ms: number, duration: number): number {
  return duration > 0 && Number.isFinite(ms) ? Math.min(100, Math.max(0, (ms / duration) * 100)) : 0;
}

/** The time for a click at `x` on a track that spans `left`..`left + width`. */
export function timeAtPoint(x: number, left: number, width: number, duration: number): number {
  return width > 0 ? Math.round(Math.min(1, Math.max(0, (x - left) / width)) * duration) : 0;
}

/** The last chapter that has started by `ms`. */
export function chapterAt<T extends { at: number }>(chapters: T[], ms: number): T | undefined {
  let found: T | undefined;
  for (const c of chapters) if (c.at <= ms && (!found || c.at >= found.at)) found = c;
  return found;
}

/**
 * MediaRecorder files often report an unknown (Infinity) or zero length and refuse seeks.
 * Seeking far past the end makes the browser find the real end; after that seeks work.
 */
export const needsDurationProbe = (videoDuration: number) => !Number.isFinite(videoDuration) || videoDuration <= 0;
export const PROBE_SEEK_SECONDS = 1e7;

/** Seconds to set on the video for a recording time, held inside the video when its own length is known. */
export function videoSeconds(edits: KeptRange[], ms: number, videoDuration: number): number {
  const s = Math.max(0, mapTime(edits, ms)) / 1000;
  return Number.isFinite(videoDuration) && videoDuration > 0 ? Math.min(s, videoDuration) : s;
}
