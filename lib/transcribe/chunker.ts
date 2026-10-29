/** Cuts the voice into about 10 s chunks of 16 kHz mono, timed in ms of recording (pauses excluded). */

export const SAMPLE_RATE = 16_000;
export const CHUNK_MS = 10_000;
// A last scrap shorter than this is not worth a model run.
export const MIN_CHUNK_MS = 500;

export interface Chunk { start: number; end: number; audio: Float32Array }  // ms into the recording

/** Linear resample to `to` Hz. Output length is round(length × to / from). */
export function resample(input: Float32Array, from: number, to = SAMPLE_RATE): Float32Array {
  if (from === to) return input.slice();
  const length = Math.round((input.length * to) / from);
  const out = new Float32Array(length);
  const step = from / to;
  for (let i = 0; i < length; i++) {
    const pos = i * step;
    const j = Math.floor(pos);
    const a = input[j] ?? 0;
    const b = input[j + 1] ?? a;
    out[i] = a + (b - a) * (pos - j);
  }
  return out;
}

/** Averages channels into one. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const out = new Float32Array(channels[0]?.length ?? 0);
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i]! += c[i]! / channels.length;
  return out;
}

const msOf = (samples: number) => Math.round((samples / SAMPLE_RATE) * 1000);

export interface Chunker {
  /** Adds 16 kHz samples; calls onChunk for each full chunk. */
  push(samples: Float32Array): void;
  /** Emits what is left (if long enough) and resets the buffer. */
  flush(): void;
  /** ms of voice taken in so far. */
  readonly elapsed: number;
}

export function createChunker(onChunk: (chunk: Chunk) => void, chunkMs = CHUNK_MS, startMs = 0): Chunker {
  const size = Math.round((SAMPLE_RATE * chunkMs) / 1000);
  let buf = new Float32Array(size);
  let fill = 0;
  let taken = Math.round((startMs / 1000) * SAMPLE_RATE);   // samples before the current buffer
  const emit = (audio: Float32Array) => {
    const start = msOf(taken);
    taken += audio.length;
    onChunk({ start, end: msOf(taken), audio });
  };
  return {
    push(samples) {
      let i = 0;
      while (i < samples.length) {
        const n = Math.min(size - fill, samples.length - i);
        buf.set(samples.subarray(i, i + n), fill);
        fill += n;
        i += n;
        if (fill === size) {
          emit(buf);
          buf = new Float32Array(size);
          fill = 0;
        }
      }
    },
    flush() {
      if (fill > 0 && msOf(fill) >= MIN_CHUNK_MS) emit(buf.slice(0, fill));
      else taken += fill;
      buf = new Float32Array(size);
      fill = 0;
    },
    get elapsed() { return msOf(taken + fill); },
  };
}

/** Cuts a whole track (already 16 kHz) into chunks. */
export function chunkAll(audio: Float32Array, chunkMs = CHUNK_MS): Chunk[] {
  const out: Chunk[] = [];
  const c = createChunker((chunk) => out.push(chunk), chunkMs);
  c.push(audio);
  c.flush();
  return out;
}

/** True when the chunk is too quiet to hold speech (Whisper invents words on silence). */
export function isSilent(audio: Float32Array, threshold = 0.004): boolean {
  let sum = 0;
  for (let i = 0; i < audio.length; i++) sum += audio[i]! * audio[i]!;
  return audio.length === 0 || Math.sqrt(sum / audio.length) < threshold;
}

/** 16-bit PCM WAV, the smallest format Groq takes without an encoder. */
export function toWav(audio: Float32Array, rate = SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + audio.length * 2);
  const v = new DataView(buffer);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + audio.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, audio.length * 2, true);
  for (let i = 0; i < audio.length; i++) {
    const s = Math.max(-1, Math.min(1, audio[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
