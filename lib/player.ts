import { chapterAt, formatLength } from './comments';
import { formatClock } from './time';
import type { Chapter, Segment } from './types';

export const SPEEDS = [1, 1.25, 1.5, 2, 0.75] as const;
/** Fullscreen controls hide after this long without movement. */
export const IDLE_MS = 3000;

/** The speed after `rate` in the cycle; an unknown rate starts again at 1x. */
export function nextSpeed(rate: number): number {
  const i = SPEEDS.indexOf(rate as (typeof SPEEDS)[number]);
  return SPEEDS[(i + 1) % SPEEDS.length] ?? 1;
}

export const speedLabel = (rate: number) => `${rate}x`;

/** "01:36 / 4:12": playhead and recording length. */
export const timeLabel = (now: number, duration: number) => `${formatClock(now)} / ${formatLength(duration)}`;

export function currentChapterTitle(chapters: Chapter[], now: number): string | undefined {
  return chapterAt(chapters, now)?.title;
}

/** The segment being spoken at `ms` (original time, the same clock as the playhead), or undefined in a gap. */
export function currentCaption(segments: Segment[], ms: number): string | undefined {
  let found: Segment | undefined;
  for (const s of segments) if (s.start <= ms && ms < s.end && (!found || s.start >= found.start)) found = s;
  const text = found?.text.trim();
  return text ? text : undefined;
}

/** Controls show while paused, or until `IDLE_MS` after the last movement. */
export function controlsVisible(playing: boolean, lastMoveAt: number, nowAt: number): boolean {
  return !playing || nowAt - lastMoveAt < IDLE_MS;
}

/** Milliseconds until the controls should hide, or 0 when they should already be hidden or never hide. */
export function hideDelay(playing: boolean, lastMoveAt: number, nowAt: number): number {
  return playing ? Math.max(0, IDLE_MS - (nowAt - lastMoveAt)) : 0;
}
