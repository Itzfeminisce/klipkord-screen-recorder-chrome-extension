import { round } from './stats';

export interface GifPlan {
  frames: number;
  width: number;
  height: number;
  // GIF stores delays in hundredths of a second, so 12 fps plays at the nearest whole step.
  delayMs: number;
  playedFps: number;
}

export function gifFramePlan(seconds: number, fps: number, width: number, aspect = 16 / 9): GifPlan {
  if (seconds <= 0 || fps <= 0 || width <= 0) return { frames: 0, width: 0, height: 0, delayMs: 0, playedFps: 0 };
  const centis = Math.max(2, Math.round(100 / fps));
  // Even height keeps the frames identical to a downscaled 16:9 recording.
  const height = Math.round(width / aspect / 2) * 2;
  return { frames: Math.round(seconds * fps), width, height, delayMs: centis * 10, playedFps: round(100 / centis, 2) };
}

export interface WordTime {
  text: string;
  start: number | null;
  end: number | null;
}

export interface WordTimesCheck {
  words: number;
  missingTimes: number;
  // A word that starts before the one before it, or ends before it starts.
  outOfOrder: number;
  pastClip: number;
  lastEndS: number | null;
}

export function checkWordTimes(words: WordTime[], clipS: number): WordTimesCheck {
  let missing = 0;
  let outOfOrder = 0;
  let pastClip = 0;
  let prevStart = -Infinity;
  let lastEnd: number | null = null;
  for (const w of words) {
    if (w.start === null || w.end === null) {
      missing++;
      continue;
    }
    if (w.start < prevStart || w.end < w.start) outOfOrder++;
    if (w.end > clipS + 0.5) pastClip++;
    prevStart = w.start;
    lastEnd = w.end;
  }
  return { words: words.length, missingTimes: missing, outOfOrder, pastClip, lastEndS: lastEnd === null ? null : round(lastEnd, 2) };
}

export function wordLine(words: WordTime[], count = 12): string {
  const t = (v: number | null) => (v === null ? '?' : v.toFixed(2));
  return words
    .slice(0, count)
    .map((w) => `${w.text.trim()} [${t(w.start)}-${t(w.end)}]`)
    .join(' ');
}
