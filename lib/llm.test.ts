import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { saveKeys } from './keys';
import { chat, LLMError, pickProvider } from './llm';

const reply = (content: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
const msgs = [{ role: 'user' as const, content: 'hi' }];

beforeEach(async () => {
  fakeBrowser.reset();
  await saveKeys({ GROQ_API_KEY: 'gsk_test' });
});

describe('chat', () => {
  it('posts an OpenAI-style request with the stored Groq key', async () => {
    const f = vi.fn(async () => reply('hello'));
    expect(await chat(msgs, { json: true, maxTokens: 300 }, f)).toBe('hello');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ temperature: 0.2, max_tokens: 300, response_format: { type: 'json_object' }, messages: msgs });
  });

  it('uses injected keys and the requested provider', async () => {
    const f = vi.fn(async () => reply('ok'));
    await chat(msgs, { keys: { OPENROUTER_API_KEY: 'sk-or-test' }, provider: 'openrouter' }, f);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(JSON.parse(init.body as string).max_tokens).toBeUndefined();
  });

  it('maps failures to codes', async () => {
    const code = async (f: () => Promise<Response>) => chat(msgs, {}, f).catch((e: LLMError) => e.code);
    expect(await code(async () => reply('x', 401))).toBe('auth');
    expect(await code(async () => reply('x', 429))).toBe('rate-limited');
    expect(await code(async () => reply('x', 500))).toBe('server');
    expect(await code(async () => reply(42))).toBe('bad-reply');
    expect(await code(async () => { throw new Error('down'); })).toBe('offline');
    expect(await chat(msgs, { keys: {} }, async () => reply('x')).catch((e: LLMError) => e.code)).toBe('no-key');
  });
});

describe('pickProvider', () => {
  it('takes the first provider with a key, or the requested one', () => {
    expect(pickProvider({ OPENAI_API_KEY: 'sk-test', GROQ_API_KEY: 'gsk_test' })?.id).toBe('groq');
    expect(pickProvider({ OPENAI_API_KEY: 'sk-test' })?.id).toBe('openai');
    expect(pickProvider({ OPENAI_API_KEY: 'sk-test' }, 'groq')).toBeUndefined();
  });
});
