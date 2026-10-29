/** Window size for voice levels. */
export const WINDOW_MS = 50;
/** Speech kept on each side of a cut pause, so words do not clip. */
export const PAD_MS = 300;
/** RMS below this counts as silence (samples are -1..1). */
export const SILENCE_RMS = 0.01;

export interface MsRange { start: number; end: number }

/** RMS of each `windowMs` window of mono samples. */
export function rmsLevels(samples: Float32Array, rate: number, windowMs = WINDOW_MS): number[] {
  const size = Math.max(1, Math.round((rate * windowMs) / 1000));
  const out: number[] = [];
  for (let i = 0; i < samples.length; i += size) {
    const end = Math.min(samples.length, i + size);
    let sum = 0;
    for (let j = i; j < end; j++) sum += samples[j]! * samples[j]!;
    out.push(Math.sqrt(sum / (end - i)));
  }
  return out;
}

/** Quiet runs of at least `minPauseMs`, shrunk by the padding on both sides; runs too short to leave anything are dropped. */
export function silenceRanges(
  levels: number[],
  windowMs: number,
  minPauseMs: number,
  { threshold = SILENCE_RMS, padMs = PAD_MS }: { threshold?: number; padMs?: number } = {},
): MsRange[] {
  const out: MsRange[] = [];
  let from = -1;
  const close = (to: number) => {
    const start = from * windowMs;
    const end = to * windowMs;
    from = -1;
    if (end - start < minPauseMs) return;
    if (end - padMs > start + padMs) out.push({ start: start + padMs, end: end - padMs });
  };
  levels.forEach((level, i) => {
    if (level < threshold) { if (from < 0) from = i; } else if (from >= 0) close(i);
  });
  if (from >= 0) close(levels.length);
  return out;
}
