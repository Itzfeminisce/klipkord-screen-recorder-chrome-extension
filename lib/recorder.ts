import type { CaptureMode, Quality } from './types';
import { formatClock } from './time';

/** Where the offscreen recorder is. 'armed' holds the picked streams while Countdown runs. */
export type RecorderStatus = 'idle' | 'armed' | 'recording' | 'paused' | 'saving' | 'done';
export type EndReason = 'user' | 'sharing-stopped' | 'disk-full';

/** Elapsed time that survives pauses: `runningSince` is null while paused. */
export interface Clock { accumulated: number; runningSince: number | null }

export interface RecorderState {
  status: RecorderStatus;
  recordingId?: string;
  mode?: CaptureMode;
  quality?: Quality;
  mic: boolean;            // mic is being recorded (false when off or blocked)
  micBlocked: boolean;
  muted: boolean;
  sound: boolean;          // tab or computer sound is in the mix
  clock: Clock;
  silentMic: boolean;
  disk?: { free: number; bytesPerSecond: number };
  endedBy?: EndReason;
}

export const IDLE: RecorderState = {
  status: 'idle', mic: false, micBlocked: false, muted: false, sound: false,
  clock: { accumulated: 0, runningSince: null }, silentMic: false,
};

export const clockStart = (now: number): Clock => ({ accumulated: 0, runningSince: now });

export function clockPause(c: Clock, now: number): Clock {
  return c.runningSince === null ? c : { accumulated: c.accumulated + Math.max(0, now - c.runningSince), runningSince: null };
}

export function clockResume(c: Clock, now: number): Clock {
  return c.runningSince === null ? { ...c, runningSince: now } : c;
}

export function clockElapsed(c: Clock, now: number): number {
  return c.accumulated + (c.runningSince === null ? 0 : Math.max(0, now - c.runningSince));
}

/** Duration without the leading zero, as frames show it: 252000 → "4:12". */
export function shortClock(ms: number): string {
  return formatClock(ms).replace(/^0(?=\d:)/, '');
}

/** Toolbar icon title while recording: "Klipkord is recording, 4 minutes 12 seconds". */
export function badgeTitle(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `Klipkord is recording, ${m} ${m === 1 ? 'minute' : 'minutes'} ${s} ${s === 1 ? 'second' : 'seconds'}`;
}

/** MP4 (H.264 + AAC) first, WebM (VP9 + Opus) second, as T0 measured. */
export const VIDEO_MIMES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
export const SILENT_VIDEO_MIMES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
export const VOICE_MIMES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];

export function chooseMime(isTypeSupported: (type: string) => boolean, hasAudio: boolean): string {
  return (hasAudio ? VIDEO_MIMES : SILENT_VIDEO_MIMES).find(isTypeSupported) ?? '';
}

export function chooseVoiceMime(isTypeSupported: (type: string) => boolean): string {
  return VOICE_MIMES.find(isTypeSupported) ?? '';
}

/** Container type stored on the Recording: 'video/mp4' or 'video/webm'. */
export const containerOf = (mime: string): string => (mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm');

export const VIDEO_BITRATE: Record<Quality, number> = { '720p': 2_500_000, '1080p': 5_000_000 };

/**
 * Appends chunks in arrival order, one write at a time, and counts bytes.
 * A failed write is reported and the next chunk still goes after it.
 */
export function createChunkWriter(append: (chunk: Blob) => Promise<void>, onError: (error: unknown) => void = () => undefined) {
  let chain: Promise<void> = Promise.resolve();
  let bytes = 0;
  return {
    write(chunk: Blob): void {
      if (!chunk.size) return;
      bytes += chunk.size;
      chain = chain.then(() => append(chunk)).catch(onError);
    },
    flush: (): Promise<void> => chain,
    get bytes() { return bytes; },
  };
}
