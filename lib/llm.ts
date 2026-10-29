/**
 * Chat client for cloud notes (OpenAI-compatible `/chat/completions`).
 * Never logs or returns a key. Errors are LLMError with a `code`.
 */
import { loadKeys } from './keys';
import type { KeyName } from './keyDetect';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ProviderId = 'groq' | 'openai' | 'openrouter' | 'anthropic';

export interface ProviderConfig { id: ProviderId; baseUrl: string; keyName: KeyName; model: string }

/** In fallback order: the first provider with a key loaded writes the notes. */
export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  groq: { id: 'groq', baseUrl: 'https://api.groq.com/openai/v1', keyName: 'GROQ_API_KEY', model: 'llama-3.3-70b-versatile' },
  openai: { id: 'openai', baseUrl: 'https://api.openai.com/v1', keyName: 'OPENAI_API_KEY', model: 'gpt-4.1-mini' },
  openrouter: { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', keyName: 'OPENROUTER_API_KEY', model: 'openai/gpt-oss-120b' },
  anthropic: { id: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', keyName: 'ANTHROPIC_API_KEY', model: 'claude-haiku-4-5' },
};

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface ChatOptions {
  provider?: ProviderId;   // default: the first provider with a key
  json?: boolean;          // ask for a JSON object reply
  maxTokens?: number;
  temperature?: number;    // default 0.2
  signal?: AbortSignal;
  keys?: Record<string, string>; // use these instead of storage
}

export type LLMErrorCode = 'no-key' | 'offline' | 'auth' | 'rate-limited' | 'server' | 'bad-reply';

export class LLMError extends Error {
  constructor(message: string, readonly code: LLMErrorCode) {
    super(message);
    this.name = 'LLMError';
  }
}

/** The provider to use: the requested one, else the first whose key is loaded. */
export function pickProvider(keys: Record<string, string>, wanted?: ProviderId): ProviderConfig | undefined {
  if (wanted) return keys[PROVIDERS[wanted].keyName] ? PROVIDERS[wanted] : undefined;
  return Object.values(PROVIDERS).find((p) => keys[p.keyName]);
}

/** Sends `messages` and returns the reply text. Throws LLMError. */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
  fetchFn: FetchLike = (u, i) => fetch(u, i),
): Promise<string> {
  const keys = opts.keys ?? (await loadKeys());
  const provider = pickProvider(keys, opts.provider);
  if (!provider) throw new LLMError('No cloud key is loaded.', 'no-key');
  const key = keys[provider.keyName];

  let res: Response;
  try {
    res = await fetchFn(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: provider.model,
        temperature: opts.temperature ?? 0.2,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        messages,
      }),
      signal: opts.signal,
    });
  } catch {
    throw new LLMError('Could not reach the AI service.', 'offline');
  }
  if (res.status === 401 || res.status === 403) throw new LLMError('The AI service did not accept the key.', 'auth');
  if (res.status === 429) throw new LLMError('The AI service is busy.', 'rate-limited');
  if (!res.ok) throw new LLMError(`The AI service returned an error (${res.status}).`, 'server');
  let content: unknown;
  try { content = ((await res.json()) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content; } catch { /* handled below */ }
  if (typeof content !== 'string') throw new LLMError('The AI service sent an unexpected reply.', 'bad-reply');
  return content;
}
