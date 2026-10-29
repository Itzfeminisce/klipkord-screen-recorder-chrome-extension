/** What a demuxer hands the encoder: track configs once known, then packets in file order. */
export interface VideoTrack { codec: string; description?: Uint8Array; width: number; height: number }
export interface AudioTrack { codec: string; description?: Uint8Array; sampleRate: number; channels: number }
export interface Tracks { video?: VideoTrack; audio?: AudioTrack }

export interface Packet {
  track: 'video' | 'audio';
  key: boolean;
  /** Microseconds from the start of the recording. */
  timestamp: number;
  duration?: number;
  data: Uint8Array;
}

export interface Demuxer {
  /** Feeds the next bytes of the file and returns the packets they completed. */
  push(bytes: Uint8Array): Packet[];
  /** Call after the last bytes; returns any packets still held. */
  end(): Packet[];
  /** Null until the track headers have been read. */
  tracks(): Tracks | null;
}

export type Container = 'mp4' | 'webm';

/** The container from the first bytes of a file; MediaRecorder writes one of the two. */
export function sniff(head: Uint8Array): Container | null {
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
  const box = String.fromCharCode(...head.subarray(4, 8));
  return box === 'ftyp' || box === 'moov' || box === 'styp' ? 'mp4' : null;
}
