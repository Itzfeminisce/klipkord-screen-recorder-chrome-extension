import { chat, type FetchLike } from '../llm';
import type { NotesEngine, Settings } from '../types';

export const OLLAMA_URL = 'http://localhost:11434';

export interface CompleteOptions { json?: boolean; signal?: AbortSignal }

export interface Engine {
  id: NotesEngine;
  /** Characters of transcript one call can take; longer transcripts are condensed in chunks. */
  maxChars: number;
  complete(system: string, user: string, opts?: CompleteOptions): Promise<string>;
}

interface LanguageModelApi {
  availability(): Promise<string>;
  create(o?: { initialPrompts?: { role: string; content: string }[]; signal?: AbortSignal }): Promise<{
    prompt(input: string, o?: { signal?: AbortSignal }): Promise<string>;
    destroy(): void;
  }>;
}

const languageModel = (g: object): LanguageModelApi | undefined => (g as { LanguageModel?: LanguageModelApi }).LanguageModel;

export async function builtinAvailable(g: object = globalThis): Promise<boolean> {
  try { return (await languageModel(g)?.availability()) === 'available'; } catch { return false; }
}

/** Chrome's built-in model has a small context, so it gets small chunks. */
function builtinEngine(g: object): Engine {
  return {
    id: 'builtin', maxChars: 8_000,
    async complete(system, user, opts) {
      const api = languageModel(g);
      if (!api) throw new Error('Chrome’s built-in AI is not available.');
      const session = await api.create({ initialPrompts: [{ role: 'system', content: system }], signal: opts?.signal });
      try { return await session.prompt(user, { signal: opts?.signal }); } finally { session.destroy(); }
    },
  };
}

/** The first model Ollama has, or null when Ollama does not answer or has none. */
export async function ollamaModel(fetchFn: FetchLike): Promise<string | null> {
  try {
    const res = await fetchFn(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: { name?: unknown }[] };
    const name = body.models?.find((m) => typeof m.name === 'string')?.name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

function ollamaEngine(model: string, fetchFn: FetchLike): Engine {
  return {
    id: 'ollama', maxChars: 16_000,
    async complete(system, user, opts) {
      const res = await fetchFn(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, stream: false, ...(opts?.json ? { format: 'json' } : {}), options: { temperature: 0.2, num_ctx: 8192 },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`Ollama returned an error (${res.status}).`);
      const content = ((await res.json()) as { message?: { content?: unknown } }).message?.content;
      if (typeof content !== 'string') throw new Error('Ollama sent an unexpected reply.');
      return content;
    },
  };
}

function groqEngine(keys: Record<string, string>, fetchFn: FetchLike): Engine {
  return {
    id: 'groq', maxChars: 30_000,
    complete: (system, user, opts) =>
      chat([{ role: 'system', content: system }, { role: 'user', content: user }], { provider: 'groq', keys, json: opts?.json, signal: opts?.signal }, fetchFn),
  };
}

/** The user's pick first, then built-in AI, Ollama and Groq in that order. */
export function engineOrder(preferred: NotesEngine): NotesEngine[] {
  return [preferred, ...(['builtin', 'ollama', 'groq'] as const).filter((e) => e !== preferred)];
}

export interface EngineDeps {
  settings: Pick<Settings, 'notesEngine'>;
  keys: Record<string, string>;
  fetchFn: FetchLike;
  /** Defaults to Chrome's `LanguageModel`; tests pass a fake. */
  globalObject?: object;
}

/** Engines that can run now, in the order to try them. Empty when none can. */
export async function availableEngines(deps: EngineDeps): Promise<Engine[]> {
  const g = deps.globalObject ?? globalThis;
  const out: Engine[] = [];
  for (const id of engineOrder(deps.settings.notesEngine)) {
    if (id === 'builtin' && (await builtinAvailable(g))) out.push(builtinEngine(g));
    else if (id === 'ollama') {
      const model = await ollamaModel(deps.fetchFn);
      if (model) out.push(ollamaEngine(model, deps.fetchFn));
    } else if (id === 'groq' && deps.keys.GROQ_API_KEY) out.push(groqEngine(deps.keys, deps.fetchFn));
  }
  return out;
}
