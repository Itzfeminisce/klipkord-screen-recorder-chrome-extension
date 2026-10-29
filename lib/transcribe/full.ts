/** The full pass (whisper-base or Groq, with word times) over a whole track, and re-transcribing an edited recording. */
import { keptRanges, toOriginal } from '@/lib/editList';
import type { KeptRange, Recording, Segment } from '@/lib/types';
import { CHUNK_MS, SAMPLE_RATE, chunkAll, isSilent } from './chunker';
import { mergeSegments, toSegment, type Heard } from './merge';

export interface FullRun {
  transcribe: (audio: Float32Array) => Promise<Heard>;
  stopped?: () => boolean;
  onProgress?: (done: number, total: number) => void;
  chunkMs?: number;
}

/** Transcribes a 16 kHz track chunk by chunk; null when stopped part way. */
export async function transcribeAll(voice: Float32Array, run: FullRun): Promise<Segment[] | null> {
  const chunks = chunkAll(voice, run.chunkMs ?? CHUNK_MS);
  const out: Segment[] = [];
  run.onProgress?.(0, chunks.length);
  for (const [i, chunk] of chunks.entries()) {
    if (run.stopped?.()) return null;
    // Whisper invents words on silence.
    if (!isSilent(chunk.audio)) out.push(toSegment(chunk.start, chunk.end, await run.transcribe(chunk.audio)));
    run.onProgress?.(i + 1, chunks.length);
  }
  return run.stopped?.() ? null : mergeSegments(out);
}

/** The voice of the edited video: the kept parts of a 16 kHz track, end to end. */
export function editedVoice(voice: Float32Array, edits: KeptRange[], duration: number): Float32Array {
  const at = (ms: number) => Math.min(voice.length, Math.round((ms / 1000) * SAMPLE_RATE));
  const parts = keptRanges(edits, duration).map((r) => voice.subarray(at(r.start), at(r.end)));
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Edited-video times back to original times, so the edit list (in original time) still applies. */
export function toOriginalSegments(segs: Segment[], edits: KeptRange[], duration: number): Segment[] {
  // An end on a part's last ms stays in that part instead of jumping past the cut.
  const end = (ms: number, from: number) => Math.max(from, ms <= 0 ? from : toOriginal(edits, duration, ms - 1) + 1);
  const map = <T extends { start: number; end: number }>(x: T): T => {
    const start = toOriginal(edits, duration, x.start);
    return { ...x, start, end: end(x.end, start) };
  };
  return segs.map((seg) => (seg.words ? { ...map(seg), words: seg.words.map(map) } : map(seg)));
}

export interface RetranscribeRun extends FullRun {
  readVoice: (recordingId: string) => Promise<Float32Array>;
}

/** Transcribes the edited video of one recording; null when stopped. Times come back in original time. */
export async function retranscribe(rec: Recording, run: RetranscribeRun): Promise<Segment[] | null> {
  const voice = editedVoice(await run.readVoice(rec.id), rec.edits, rec.duration);
  const segs = await transcribeAll(voice, run);
  return segs && toOriginalSegments(segs, rec.edits, rec.duration);
}

/** What a finished re-transcribe writes: the transcript only. Cuts, notes and comments stay as they are. */
export function retranscribedPatch(segs: Segment[]): Pick<Recording, 'transcript' | 'transcriptPending' | 'transcriptModel'> {
  return { transcript: segs, transcriptPending: false, transcriptModel: 'full' };
}
