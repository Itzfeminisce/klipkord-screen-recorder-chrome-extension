/** Whisper in a worker (transformers.js, wasm q8, or WebGPU when there is an adapter). Models measured in T0. */
import type { Heard } from './merge';

export const LIVE_MODEL = 'onnx-community/whisper-tiny';   // RTF 0.29 on wasm q8, one thread
// The _timestamped export carries the cross attentions that word times need (T0: plain exports give none).
export const BASE_MODEL = 'onnx-community/whisper-base_timestamped';   // re-transcribes after stop, with word times
// whisper-small is not offered: RTF 2.1 on the same machine.

/** With a WebGPU adapter, live may use base. */
export function liveModel(webgpu: boolean): string {
  return webgpu ? BASE_MODEL : LIVE_MODEL;
}

export type Device = 'webgpu' | 'wasm';

export interface FileProgress { loaded: number; total: number; done: boolean }
export interface ProgressEvent { model: string; status: string; file: string; loaded: number; total: number }

// tiny + base on wasm q8, so the bar has a fair size before every file has reported.
export const EXPECTED_BYTES = 125_000_000;

export interface DownloadSummary { loaded: number; total: number; percent: number }

/** Sums every file seen so far; total never drops below the expected size until all files are done. */
export function summarize(files: Iterable<FileProgress>, expected = EXPECTED_BYTES, finished = false): DownloadSummary {
  let loaded = 0;
  let total = 0;
  for (const f of files) {
    total += f.total;
    loaded += f.done ? f.total : Math.min(f.loaded, f.total || f.loaded);
  }
  if (!finished) total = Math.max(total, expected);
  else loaded = total;
  const percent = total ? Math.min(100, Math.floor((loaded / total) * 100)) : 0;
  return { loaded, total, percent };
}

/** Folds one progress event into the file table. */
export function track(files: Map<string, FileProgress>, p: ProgressEvent): void {
  const key = `${p.model}/${p.file}`;
  const f = files.get(key) ?? { loaded: 0, total: 0, done: false };
  if (p.total > 0) f.total = p.total;
  if (p.loaded > f.loaded) f.loaded = p.loaded;
  if (p.status === 'done') f.done = true;
  files.set(key, f);
}

export const megabytes = (bytes: number) => Math.round(bytes / 1_000_000);

/** "about 1 minute left" from bytes left and the rate so far; null before there is a rate. */
export function timeLeft(loaded: number, total: number, elapsedMs: number): string | null {
  if (loaded <= 0 || elapsedMs < 1000) return null;
  const seconds = (total - loaded) / (loaded / (elapsedMs / 1000));
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`;
}

type Answer = { type: string; id?: number; [k: string]: unknown };
type Waiter = { resolve: (a: Answer) => void; reject: (e: Error) => void };

/** Talks to whisper.worker.ts. Each request gets one answer by id; progress events are not answers. */
export class Whisper {
  private worker: Worker;
  private next = 1;
  private waiting = new Map<number, Waiter>();
  onProgress: ((p: ProgressEvent) => void) | null = null;

  constructor(make: () => Worker) {
    this.worker = make();
    this.worker.onmessage = (e: MessageEvent<Answer>) => {
      const a = e.data;
      if (a.type === 'progress') return this.onProgress?.(a as unknown as ProgressEvent);
      const w = a.id !== undefined ? this.waiting.get(a.id) : undefined;
      if (!w) {
        if (a.type === 'error') this.failAll(new Error(String(a.message)));
        return;
      }
      this.waiting.delete(a.id!);
      if (a.type === 'error') w.reject(new Error(String(a.message)));
      else w.resolve(a);
    };
    this.worker.onerror = (e) => this.failAll(new Error(`Whisper worker: ${e.message || 'could not start'}`));
  }

  private failAll(error: Error) {
    for (const w of this.waiting.values()) w.reject(error);
    this.waiting.clear();
  }

  private ask(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<Answer> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  /** Downloads (or reads from cache) and loads a model. */
  async load(model: string): Promise<Device> {
    return (await this.ask({ type: 'load', model })).device as Device;
  }

  /** With `words`, the model must be a _timestamped one; word times are ms from the start of `audio`. */
  async transcribe(audio: Float32Array, language = 'auto', words = false): Promise<Heard> {
    const copy = audio.slice();
    const a = await this.ask({ type: 'transcribe', audio: copy, language, words }, [copy.buffer]);
    return { text: String(a.text ?? ''), ...(Array.isArray(a.words) ? { words: a.words as Heard['words'] } : {}) };
  }

  async dispose(): Promise<void> {
    await this.ask({ type: 'dispose' });
  }

  terminate() {
    this.worker.terminate();
    this.failAll(new Error('Whisper stopped'));
  }
}
