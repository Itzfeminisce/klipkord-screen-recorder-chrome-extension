export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export interface FrameStats {
  frames: number;
  meanFps: number;
  droppedFrames: number;
}

// Frame times in ms (requestVideoFrameCallback `now`). A gap longer than 1.5 frame periods counts its missing frames.
export function frameStats(timesMs: number[], targetFps: number): FrameStats {
  const frames = timesMs.length;
  if (frames < 2) return { frames, meanFps: 0, droppedFrames: 0 };
  const period = 1000 / targetFps;
  let dropped = 0;
  for (let i = 1; i < frames; i++) {
    const gap = timesMs[i]! - timesMs[i - 1]!;
    if (gap > period * 1.5) dropped += Math.round(gap / period) - 1;
  }
  const spanS = (timesMs[frames - 1]! - timesMs[0]!) / 1000;
  return { frames, meanFps: round((frames - 1) / spanS), droppedFrames: dropped };
}

// Processing time over audio time; below 1 keeps up with live speech.
export function realTimeFactor(processingMs: number, audioMs: number): number {
  if (audioMs <= 0) return 0;
  return round(processingMs / audioMs, 2);
}

// Root mean square of samples in dBFS; silence is -Infinity, reported as null.
export function levelDb(samples: Float32Array): number | null {
  if (samples.length === 0) return null;
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / samples.length);
  return rms === 0 ? null : round(20 * Math.log10(rms));
}

export function megabytes(bytes: number): number {
  return round(bytes / 1_000_000);
}

export interface FileProgress {
  loaded: number;
  total: number;
  done: boolean;
}

export interface DownloadSummary {
  files: number;
  doneFiles: number;
  loadedBytes: number;
  totalBytes: number;
  allDone: boolean;
}

// Sums per-file download progress; a finished file counts its full size.
export function downloadSummary(files: Iterable<FileProgress>): DownloadSummary {
  const s: DownloadSummary = { files: 0, doneFiles: 0, loadedBytes: 0, totalBytes: 0, allDone: false };
  for (const f of files) {
    s.files++;
    if (f.done) s.doneFiles++;
    s.totalBytes += f.total;
    s.loadedBytes += f.done ? Math.max(f.loaded, f.total) : f.loaded;
  }
  s.allDone = s.files > 0 && s.doneFiles === s.files;
  return s;
}
