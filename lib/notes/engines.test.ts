import { describe, expect, it, vi } from 'vitest';
import { availableEngines, builtinAvailable, engineOrder, ollamaModel } from './engines';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ollamaUp = vi.fn(async (url: string, _init?: RequestInit) => (url.endsWith('/api/tags') ? json({ models: [{ name: 'llama3.2' }] }) : json({ message: { content: '{}' } })));
const down = vi.fn(async () => { throw new TypeError('offline'); });
const builtin = (availability: string) => ({ LanguageModel: { availability: async () => availability } });
const ids = async (o: Parameters<typeof availableEngines>[0]) => (await availableEngines(o)).map((e) => e.id);

describe('engineOrder', () => {
  it('puts the pick first, then built-in, Ollama, Groq', () => {
    expect(engineOrder('builtin')).toEqual(['builtin', 'ollama', 'groq']);
    expect(engineOrder('groq')).toEqual(['groq', 'builtin', 'ollama']);
  });
});

describe('availableEngines', () => {
  const base = { settings: { notesEngine: 'builtin' as const }, keys: {}, globalObject: {} };

  it('uses built-in AI when Chrome has it', async () => {
    expect(await ids({ ...base, fetchFn: down, globalObject: builtin('available') })).toEqual(['builtin']);
  });
  it('falls back to Ollama when built-in AI is missing and Ollama answers', async () => {
    expect(await ids({ ...base, fetchFn: ollamaUp })).toEqual(['ollama']);
  });
  it('falls back to Groq only with a key', async () => {
    expect(await ids({ ...base, fetchFn: down, keys: { GROQ_API_KEY: 'gsk_test' } })).toEqual(['groq']);
    expect(await ids({ ...base, fetchFn: down })).toEqual([]);
  });
  it('lists every engine that works, in order', async () => {
    expect(await ids({ ...base, fetchFn: ollamaUp, keys: { GROQ_API_KEY: 'gsk_test' }, globalObject: builtin('available') })).toEqual(['builtin', 'ollama', 'groq']);
  });
  it('treats a model that still needs a download as unavailable', async () => {
    expect(await builtinAvailable(builtin('downloadable'))).toBe(false);
    expect(await builtinAvailable({})).toBe(false);
  });
});

describe('engines', () => {
  it('asks Ollama for JSON with the first model it has', async () => {
    expect(await ollamaModel(ollamaUp)).toBe('llama3.2');
    expect(await ollamaModel(async () => json({ models: [] }))).toBeNull();
    const [engine] = await availableEngines({ settings: { notesEngine: 'ollama' }, keys: {}, fetchFn: ollamaUp, globalObject: {} });
    expect(await engine!.complete('s', 'u', { json: true })).toBe('{}');
    const call = ollamaUp.mock.calls.find(([u]) => u.endsWith("/api/chat"))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toMatchObject({ model: 'llama3.2', format: 'json', stream: false });
  });
  it('calls Groq with the key and no key in the result', async () => {
    const f = vi.fn(async (u: string) => (u.includes('11434') ? json({}, 500) : json({ choices: [{ message: { content: 'ok' } }] })));
    const [engine] = await availableEngines({ settings: { notesEngine: 'groq' }, keys: { GROQ_API_KEY: 'gsk_test' }, fetchFn: f, globalObject: {} });
    expect(await engine!.complete('s', 'u')).toBe('ok');
    expect(f.mock.calls.at(-1)![0]).toBe('https://api.groq.com/openai/v1/chat/completions');
  });
});
