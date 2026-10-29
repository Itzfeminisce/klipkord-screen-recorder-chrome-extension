import type { Status } from './results';

export const QUIET_DB = -60;
export const AI_MIN_CHROME = 138;

// Sound passes only when the capture heard something louder than near-silence.
export function soundStatus(peakDb: number | null): Status {
  return peakDb !== null && peakDb >= QUIET_DB ? 'pass' : 'warn';
}

// Major version from "132.0.6834.160" or a user agent with "Chrome/132.".
export function chromeMajor(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /Chrome\/(\d+)\./.exec(text) ?? /^(\d+)\./.exec(text);
  return m ? Number(m[1]) : null;
}

export function builtinAiNote(major: number | null, availabilities: string[]): string | null {
  const missing = availabilities.some((a) => a === 'missing');
  return missing && major !== null && major < AI_MIN_CHROME ? `needs Chrome ${AI_MIN_CHROME} or newer` : null;
}

export interface Size {
  width: number;
  height: number;
}

// The composite target is 1080p, or the screen's real size when that is smaller. Even sizes suit the encoder.
export function captureTarget(screenSize: Size, max: Size = { width: 1920, height: 1080 }): Size {
  const scale = Math.min(1, max.width / screenSize.width, max.height / screenSize.height);
  const even = (n: number) => Math.max(2, Math.floor((n * scale) / 2) * 2);
  return { width: even(screenSize.width), height: even(screenSize.height) };
}

export const SMALL_MAX_BASE_RTF = 0.5;

// whisper-small runs only when whisper-base was clearly faster than real time; otherwise the note says why not.
export function smallSkipNote(baseRtf: number | null): string | null {
  if (baseRtf === null) return 'skipped: no whisper-base realTimeFactor';
  return baseRtf < SMALL_MAX_BASE_RTF ? null : `skipped: whisper-base realTimeFactor ${baseRtf} is not below ${SMALL_MAX_BASE_RTF}`;
}
