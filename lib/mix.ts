/** Mic level below this RMS counts as silence. */
export const SILENCE_RMS = 0.004;
export const SILENT_MIC_MS = 30_000;

/** RMS of a block of samples, 0..1. */
export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const v of samples) sum += v * v;
  return Math.sqrt(sum / samples.length);
}

/** How many of `bars` meter bars to light for an RMS level (speech sits around 0.02–0.2). */
export function meterBars(level: number, bars = 8): number {
  if (!(level > SILENCE_RMS)) return 0;
  const db = 20 * Math.log10(level);                 // about -48 .. 0
  return Math.max(0, Math.min(bars, Math.round(((db + 48) / 40) * bars)));
}

/** Says when the mic has been silent for `ms` while not muted. */
export function createSilenceWatch(ms = SILENT_MIC_MS) {
  let quietSince: number | null = null;
  return (level: number, now: number, muted: boolean): boolean => {
    if (muted || level > SILENCE_RMS) {
      quietSince = null;
      return false;
    }
    quietSince ??= now;
    return now - quietSince >= ms;
  };
}

export interface Mix {
  /** The mixed audio track for the video, or null when there is no audio at all. */
  track: MediaStreamTrack | null;
  /** Current mic RMS (0 when there is no mic). */
  micLevel(): number;
  close(): Promise<void>;
}

/** Mixes mic and tab or computer sound into one track with Web Audio. */
export function createMix(ctx: AudioContext, mic: MediaStream | null, sound: MediaStream | null): Mix {
  const dest = ctx.createMediaStreamDestination();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const buf = new Float32Array(analyser.fftSize);
  const hasMic = Boolean(mic?.getAudioTracks().length);
  const hasSound = Boolean(sound?.getAudioTracks().length);

  if (hasMic && mic) {
    const src = ctx.createMediaStreamSource(mic);
    src.connect(analyser);
    src.connect(dest);
  }
  if (hasSound && sound) ctx.createMediaStreamSource(new MediaStream(sound.getAudioTracks())).connect(dest);

  return {
    track: hasMic || hasSound ? dest.stream.getAudioTracks()[0] ?? null : null,
    micLevel() {
      if (!hasMic) return 0;
      analyser.getFloatTimeDomainData(buf);
      return rms(buf);
    },
    close: () => ctx.close().catch(() => undefined),
  };
}
