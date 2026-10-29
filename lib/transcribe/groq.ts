/** Groq speech-to-text, adapted from Rekord. Sends audio only, never video. Never logs or returns the key. */
import { PROVIDERS, type FetchLike } from '@/lib/llm';
import { loadKeys } from '@/lib/keys';
import { getSettings } from '@/lib/settings';
import type { AiMode } from '@/lib/types';
import { toWav } from './chunker';
import type { Heard } from './merge';

export const GROQ_MODEL = 'whisper-large-v3-turbo';

export type GroqErrorCode = 'no-key' | 'offline' | 'auth' | 'rate-limited' | 'server' | 'bad-request';

export class GroqError extends Error {
  constructor(message: string, readonly code: GroqErrorCode) {
    super(message);
    this.name = 'GroqError';
  }
}

export interface GroqOptions { key: string; language?: string; signal?: AbortSignal }

// Long enough to keep requests few on a re-transcribe; a WAV of this is about 10 MB, under Groq's file limit.
export const GROQ_CHUNK_MS = 5 * 60_000;

interface GroqWord { word?: unknown; start?: unknown; end?: unknown }

/** Groq's word list (seconds) as Words in ms; entries without a word or times are dropped. */
export function parseWords(list: unknown): Heard['words'] {
  if (!Array.isArray(list)) return undefined;
  return (list as GroqWord[]).flatMap((w) => {
    if (typeof w?.word !== 'string' || typeof w.start !== 'number' || typeof w.end !== 'number') return [];
    return [{ start: Math.round(w.start * 1000), end: Math.round(w.end * 1000), text: w.word.trim() }];
  });
}

/** Transcribes one 16 kHz chunk and returns its text and word times. Throws GroqError. */
export async function transcribeGroq(audio: Float32Array, opts: GroqOptions, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<Heard> {
  if (!opts.key) throw new GroqError('No Groq key is loaded.', 'no-key');
  const form = new FormData();
  form.append('file', new Blob([toWav(audio)], { type: 'audio/wav' }), 'chunk.wav');
  form.append('model', GROQ_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  if (opts.language && opts.language !== 'auto') form.append('language', opts.language);

  let res: Response;
  try {
    res = await fetchFn(`${PROVIDERS.groq.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.key}` },
      body: form,
      signal: opts.signal,
    });
  } catch {
    throw new GroqError('Could not reach Groq.', 'offline');
  }
  if (res.status === 401 || res.status === 403) throw new GroqError('Groq did not accept the key.', 'auth');
  if (res.status === 429) throw new GroqError('Groq is busy.', 'rate-limited');
  if (res.status >= 500) throw new GroqError(`Groq returned an error (${res.status}).`, 'server');
  if (!res.ok) throw new GroqError(`Groq returned an error (${res.status}).`, 'bad-request');
  let body: { text?: unknown; words?: unknown };
  try {
    body = (await res.json()) as { text?: unknown; words?: unknown };
  } catch {
    throw new GroqError('Groq sent an unexpected reply.', 'server');
  }
  const words = parseWords(body.words);
  return { text: typeof body.text === 'string' ? body.text.trim() : '', ...(words ? { words } : {}) };
}

export interface TranscriptConfig { ai: AiMode; language: string; groqKey: string | null }

/** Read where chrome.storage exists (background), for the offscreen document, which has no storage API. */
export async function loadTranscriptConfig(): Promise<TranscriptConfig> {
  const [settings, keys] = await Promise.all([getSettings(), loadKeys()]);
  return { ai: settings.ai, language: settings.language, groqKey: keys[PROVIDERS.groq.keyName] ?? null };
}
