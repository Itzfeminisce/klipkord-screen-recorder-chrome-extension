import type { Segment } from '@/lib/types';
import { isSilent, type Chunk } from './chunker';
import { GroqError } from './groq';

export type Engine = 'local' | 'groq';

export interface QueueStatus {
  pending: number;          // chunks waiting or running
  behind: boolean;          // live text has fallen well behind (transcript-behind)
  engine: Engine;           // where the last chunk ran, or will run
  cloudDown: boolean;       // Groq failed this recording; local from now on (cloud-ai-down)
  offline: boolean;         // Groq chosen but no network; local until back online
}

export interface QueueDeps {
  local: (audio: Float32Array) => Promise<string>;
  groq: (audio: Float32Array) => Promise<string>;
  online: () => boolean;
  onSegment: (seg: Segment) => void;
  onStatus: (status: QueueStatus) => void;
}

export type TranscriptPhase = 'live' | 'catch-up' | 'base' | 'done';

/** What the side panel shows: the live text, where it runs and how far behind it is. */
export interface TranscriptStatus extends QueueStatus {
  recordingId: string;
  phase: TranscriptPhase;
  segments: Segment[];
  busy: boolean;            // work left for this recording (the offscreen document must stay open)
}

// Three chunks waiting means the text is about half a minute behind.
export const BEHIND_AFTER = 3;

export interface TranscriptQueue {
  add(chunk: Chunk): void;
  /** "Use Groq for this one": later chunks go to Groq. */
  useGroq(): void;
  /** Resolves when every queued chunk is done. */
  drain(): Promise<void>;
  /** Drops waiting chunks; the running one finishes but is not reported. */
  cancel(): void;
  readonly status: QueueStatus;
}

export function createQueue(deps: QueueDeps, wanted: Engine, behindAfter = BEHIND_AFTER): TranscriptQueue {
  const waiting: Chunk[] = [];
  let running = false;
  let cancelled = false;
  let cloudDown = false;
  let offline = false;
  let lastEngine: Engine = wanted;
  let idle: (() => void)[] = [];

  const status = (): QueueStatus => {
    const pending = waiting.length;   // the running chunk stays first until it is done
    return { pending, behind: pending >= behindAfter, engine: lastEngine, cloudDown, offline };
  };
  const report = () => deps.onStatus(status());

  async function runOne(chunk: Chunk): Promise<string> {
    const cloud = wanted === 'groq' && !cloudDown;
    offline = cloud && !deps.online();
    if (cloud && !offline) {
      try {
        lastEngine = 'groq';
        return await deps.groq(chunk.audio);
      } catch (error) {
        console.error('Klipkord: could not transcribe with Groq', error);
        // A dropped network is offline (back to Groq later); anything else means Groq is down for this recording.
        if (error instanceof GroqError && error.code === 'offline' && !deps.online()) offline = true;
        else cloudDown = true;
      }
    }
    lastEngine = 'local';
    report();
    return deps.local(chunk.audio);
  }

  async function pump() {
    if (running) return;
    running = true;
    while (waiting.length && !cancelled) {
      const chunk = waiting[0]!;
      report();
      try {
        const text = isSilent(chunk.audio) ? '' : await runOne(chunk);
        if (!cancelled && text) deps.onSegment({ start: chunk.start, end: chunk.end, text });
      } catch (error) {
        console.error('Klipkord: could not transcribe a chunk', error);
      }
      waiting.shift();
    }
    running = false;
    report();
    const done = idle;
    idle = [];
    done.forEach((resolve) => resolve());
  }

  return {
    add(chunk) {
      if (cancelled) return;
      waiting.push(chunk);
      report();
      void pump();
    },
    useGroq() {
      wanted = 'groq';
      cloudDown = false;
      report();
    },
    drain() {
      if (!running && !waiting.length) return Promise.resolve();
      return new Promise((resolve) => idle.push(resolve));
    },
    cancel() {
      cancelled = true;
      waiting.length = running ? 1 : 0;
    },
    get status() { return status(); },
  };
}
