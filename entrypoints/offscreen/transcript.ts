import { updateRecording } from '@/lib/db';
import { send } from '@/lib/messages';
import type { Recording, Segment } from '@/lib/types';
import { videoStore } from '@/lib/videoStore';
import { SAMPLE_RATE, chunkAll, createChunker, resample, toMono, type Chunk, type Chunker } from '@/lib/transcribe/chunker';
import { transcribeGroq, type TranscriptConfig } from '@/lib/transcribe/groq';
import { appendSegment, mergeSegments, replaceTranscript } from '@/lib/transcribe/merge';
import { createQueue, type QueueStatus, type TranscriptPhase, type TranscriptQueue, type TranscriptStatus } from '@/lib/transcribe/queue';
import { BASE_MODEL, Whisper, liveModel } from '@/lib/transcribe/whisper';

// Live transcript runs here, beside the recorder, so it keeps going with the side panel closed.
// It never awaits inside a recorder command: the recorder only starts, pauses and stops it.

// Decoding a longer voice track at 16 kHz could use too much memory; the live text is kept instead.
const BASE_PASS_MAX_MS = 90 * 60_000;

interface Live {
  recordingId: string;
  config: TranscriptConfig;
  readonly queue: TranscriptQueue;
  chunker: Chunker;
  segments: Segment[];
  phase: TranscriptPhase;
  paused: boolean;
  stopCapture: () => void;
  aborted: boolean;
}

let live: Live | null = null;
let whisper: Whisper | null = null;
let loading: { model: string; ready: Promise<unknown> } | null = null;

const makeWorker = () => new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  return Boolean(await gpu?.requestAdapter().catch(() => null));
}

/** Loads `model` once; a failed load is tried again on the next chunk. */
function ensureModel(model: string): Promise<unknown> {
  whisper ??= new Whisper(makeWorker);
  if (loading?.model === model) return loading.ready;
  const w = whisper;
  const ready = w.load(model).catch((error) => {
    if (loading?.ready === ready) loading = null;
    throw error;
  });
  loading = { model, ready };
  return ready;
}

function releaseWhisper() {
  whisper?.terminate();
  whisper = null;
  loading = null;
}

function status(l: Live, q: QueueStatus = l.queue.status): TranscriptStatus {
  const busy = l.phase !== 'done';
  return { ...q, behind: q.behind && l.phase === 'live', recordingId: l.recordingId, phase: l.phase, segments: l.segments, busy };
}

function report(l: Live, q?: QueueStatus) {
  if (live === l || l.phase === 'done') void send({ type: 'transcript/status', status: status(l, q) });
}

async function config(): Promise<TranscriptConfig> {
  const c = await send<TranscriptConfig>({ type: 'transcript/config' });
  return c ?? { ai: 'local', language: 'auto', groqKey: null };
}

/** Taps the mic, resamples to 16 kHz and feeds the chunker while recording (not while paused). */
function capture(track: MediaStreamTrack, onSamples: (s: Float32Array) => void, isPaused: () => boolean): () => void {
  const ctx = new AudioContext();
  void ctx.resume().catch(() => undefined);
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  // ScriptProcessor needs no extra module file; its output is silent.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (e) => {
    if (isPaused()) return;
    onSamples(resample(e.inputBuffer.getChannelData(0), ctx.sampleRate, SAMPLE_RATE));
  };
  source.connect(node);
  node.connect(ctx.destination);
  return () => {
    node.onaudioprocess = null;
    node.disconnect();
    source.disconnect();
    void ctx.close().catch(() => undefined);
  };
}

/** Starts the live transcript for a new take. A base pass still running for an earlier take is dropped. */
export async function startTranscript(recordingId: string, mic: MediaStreamTrack | null): Promise<void> {
  if (live) cancelTranscript();
  if (!mic) return;
  // Listening starts at once so chunk times match the recording; the queue follows once settings arrive.
  const early: Chunk[] = [];
  let queue: TranscriptQueue | null = null;
  const l: Live = {
    recordingId, config: { ai: 'local', language: 'auto', groqKey: null }, segments: [], phase: 'live', paused: false, aborted: false,
    stopCapture: () => undefined,
    chunker: createChunker((chunk) => (queue ? queue.add(chunk) : early.push(chunk))),
    get queue() { return queue ?? idleQueue; },
  };
  live = l;
  l.stopCapture = capture(mic, (s) => l.chunker.push(s), () => l.paused);

  const [cfg, webgpu] = await Promise.all([config(), hasWebGpu()]);
  if (l.aborted) return;
  l.config = cfg;
  const model = liveModel(webgpu);
  queue = createQueue({
    local: async (audio) => {
      await ensureModel(model);
      return whisper!.transcribe(audio, l.config.language);
    },
    groq: (audio) => transcribeGroq(audio, { key: l.config.groqKey ?? '', language: l.config.language }),
    online: () => navigator.onLine,
    onSegment: (seg) => {
      l.segments = appendSegment(l.segments, seg);
    },
    onStatus: (q) => report(l, q),
  }, cfg.ai === 'cloud' && cfg.groqKey ? 'groq' : 'local');
  early.splice(0).forEach((chunk) => queue!.add(chunk));
  // Fetch the model now so the first chunk does not wait on the download.
  if (cfg.ai === 'local') void ensureModel(model).catch((error) => console.error('Klipkord: could not load Whisper', error));
  report(l);
}

// Stands in until settings arrive; holds nothing.
const idleQueue: TranscriptQueue = createQueue({
  local: async () => '', groq: async () => '', online: () => true, onSegment: () => undefined, onStatus: () => undefined,
}, 'local');

export function pauseTranscript(paused: boolean) {
  if (live) live.paused = paused;
}

/** What the recorder writes with each save while live: the text so far and whether chunks still queue. */
export function transcriptPatch(recordingId: string): Partial<Recording> {
  const l = live;
  if (!l || l.recordingId !== recordingId) return {};
  return { transcript: l.segments, transcriptPending: l.queue.status.pending > 0 };
}

/** "Use Groq for this one". */
export async function useGroq() {
  const l = live;
  if (!l) return;
  const cfg = await config();
  if (!cfg.groqKey) return;
  l.config = { ...l.config, groqKey: cfg.groqKey };
  l.queue.useGroq();
}

export function currentStatus(): TranscriptStatus | null {
  return live ? status(live) : null;
}

/** Stops listening; the queued chunks and the base pass go on in the background. Call after the recorder's last save. */
export function stopCapture(): Live | null {
  const l = live;
  if (!l) return null;
  l.stopCapture();
  l.chunker.flush();
  return l;
}

async function save(recordingId: string, patch: Partial<Recording>) {
  try {
    await updateRecording(recordingId, patch);
  } catch (error) {
    console.error('Klipkord: could not save the transcript', error);
  }
}

/** Decodes the saved voice track to 16 kHz mono. */
async function readVoice(recordingId: string): Promise<Float32Array> {
  const blob = await videoStore.read(recordingId, 'voice');
  if (!blob.size) return new Float32Array(0);
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  return resample(toMono(channels), audio.sampleRate, SAMPLE_RATE);
}

/** whisper-base over the whole voice track; null when it cannot run, so the live text stays. */
async function basePass(l: Live, durationMs: number): Promise<Segment[] | null> {
  if (durationMs > BASE_PASS_MAX_MS) return null;
  try {
    const voice = await readVoice(l.recordingId);
    if (l.aborted || !voice.length) return null;
    await ensureModel(BASE_MODEL);
    const out: Segment[] = [];
    for (const chunk of chunkAll(voice)) {
      if (l.aborted) return null;
      const text = await whisper!.transcribe(chunk.audio, l.config.language);
      out.push({ start: chunk.start, end: chunk.end, text });
    }
    return mergeSegments(out);
  } catch (error) {
    console.error('Klipkord: could not run the full transcript', error);
    return null;
  }
}

/** After stop: catch up the queued chunks, then (on this computer) let whisper-base replace the live text. */
export async function finishTranscript(recordingId: string, durationMs: number): Promise<void> {
  const l = live?.recordingId === recordingId ? live : null;
  if (!l) return void send({ type: 'transcript/idle' });
  l.phase = 'catch-up';
  report(l);
  await l.queue.drain();
  await save(recordingId, { transcript: l.segments, transcriptPending: true });
  const q = l.queue.status;
  if (!l.aborted && q.engine === 'local') {
    l.phase = 'base';
    report(l);
    const base = await basePass(l, durationMs);
    if (base) l.segments = replaceTranscript(l.segments, base);
  }
  if (!l.aborted) await save(recordingId, { transcript: l.segments, transcriptPending: false });
  l.phase = 'done';
  report(l);
  if (live === l) live = null;
  // A newer take keeps the worker for its own live text.
  if (!live) releaseWhisper();
  void send({ type: 'transcript/idle' });
}

/** Drops the live transcript (discard, restart, or a new take while a base pass runs). */
export function cancelTranscript() {
  const l = live;
  if (!l) return;
  live = null;
  l.aborted = true;
  l.stopCapture();
  l.queue.cancel();
  // A base pass cut short keeps the live text and clears the pending flag.
  if (l.phase !== 'live') void save(l.recordingId, { transcript: l.segments, transcriptPending: false });
  l.phase = 'done';
}
