/** Groq speech-to-text, adapted from Rekord. Sends audio only, never video. Never logs or returns the key. */
import { PROVIDERS, type FetchLike } from '@/lib/llm';
import { loadKeys } from '@/lib/keys';
import { getSettings } from '@/lib/settings';
import type { AiMode } from '@/lib/types';
import { toWav } from './chunker';

export const GROQ_MODEL = 'whisper-large-v3-turbo';

export type GroqErrorCode = 'no-key' | 'offline' | 'auth' | 'rate-limited' | 'server' | 'bad-request';

export class GroqError extends Error {
  constructor(message: string, readonly code: GroqErrorCode) {
    super(message);
    this.name = 'GroqError';
  }
}

export interface GroqOptions { key: string; language?: string; signal?: AbortSignal }

/** Transcribes one 16 kHz chunk and returns its text. Throws GroqError. */
export async function transcribeGroq(audio: Float32Array, opts: GroqOptions, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<string> {
  if (!opts.key) throw new GroqError('No Groq key is loaded.', 'no-key');
  const form = new FormData();
  form.append('file', new Blob([toWav(audio)], { type: 'audio/wav' }), 'chunk.wav');
  form.append('model', GROQ_MODEL);
  form.append('response_format', 'json');
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
  let body: { text?: unknown };
  try {
    body = (await res.json()) as { text?: unknown };
  } catch {
    throw new GroqError('Groq sent an unexpected reply.', 'server');
  }
  return typeof body.text === 'string' ? body.text.trim() : '';
}

export interface TranscriptConfig { ai: AiMode; language: string; groqKey: string | null }

/** Read where chrome.storage exists (background), for the offscreen document, which has no storage API. */
export async function loadTranscriptConfig(): Promise<TranscriptConfig> {
  const [settings, keys] = await Promise.all([getSettings(), loadKeys()]);
  return { ai: settings.ai, language: settings.language, groqKey: keys[PROVIDERS.groq.keyName] ?? null };
}
