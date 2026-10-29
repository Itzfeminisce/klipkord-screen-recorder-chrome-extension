import { guard, StoppedError } from '@/lib/check/guard';

export type Answer = Record<string, unknown>;

export class WhisperWorker {
  private worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  private waiting: { resolve: (m: Answer) => void; reject: (e: Error) => void }[] = [];
  onProgress: ((m: Answer) => void) | null = null;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<Answer>) => {
      if (e.data.type === 'progress') return this.onProgress?.(e.data);
      const w = this.waiting.shift();
      if (e.data.type === 'error') w?.reject(new Error(String(e.data.message)));
      else w?.resolve(e.data);
    };
    this.worker.onerror = (e) => this.failAll(new Error(`Whisper worker: ${e.message || 'could not start'}`));
  }

  private failAll(error: Error) {
    for (const w of this.waiting.splice(0)) w.reject(error);
  }

  // The worker answers each message once, in order; progress messages are not answers.
  send(msg: unknown, opts: { ms: number; what: string; signal?: AbortSignal }, transfer: Transferable[] = []) {
    const answer = new Promise<Answer>((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.worker.postMessage(msg, transfer);
    });
    return guard(answer, opts);
  }

  terminate() {
    this.worker.terminate();
    this.failAll(new StoppedError());
  }
}
