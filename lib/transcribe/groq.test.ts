import { describe, expect, it, vi } from 'vitest';
import { GroqError, GROQ_MODEL, parseWords, transcribeGroq } from './groq';

const KEY = 'gsk_test';
const audio = new Float32Array(1600).fill(0.1);
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe('transcribeGroq', () => {
  it('posts a WAV of the audio with the model and language, and returns the text', async () => {
    const fetchFn = vi.fn(async () => reply(200, { text: ' Hello there. ' }));
    await expect(transcribeGroq(audio, { key: KEY, language: 'en' }, fetchFn)).resolves.toEqual({ text: 'Hello there.' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const form = init.body as FormData;
    expect(form.get('model')).toBe(GROQ_MODEL);
    expect(form.get('language')).toBe('en');
    expect((form.get('file') as File).type).toBe('audio/wav');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.getAll('timestamp_granularities[]')).toEqual(['word', 'segment']);
  });
  it('reads word times in seconds as ms and drops malformed entries', async () => {
    const words = [{ word: ' Hello', start: 0.12, end: 0.5 }, { word: 'there.', start: 0.5, end: 0.98 }, { word: 'x' }, null];
    const fetchFn = vi.fn(async () => reply(200, { text: 'Hello there.', words, segments: [{ start: 0, end: 1, text: 'Hello there.' }] }));
    await expect(transcribeGroq(audio, { key: KEY }, fetchFn)).resolves.toEqual({
      text: 'Hello there.', words: [{ start: 120, end: 500, text: 'Hello' }, { start: 500, end: 980, text: 'there.' }],
    });
    expect(parseWords('nope')).toBeUndefined();
  });
  it('leaves language out on auto', async () => {
    const fetchFn = vi.fn(async () => reply(200, { text: 'x' }));
    await transcribeGroq(audio, { key: KEY, language: 'auto' }, fetchFn);
    expect(((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData).has('language')).toBe(false);
  });
  it.each([
    [401, 'auth'], [429, 'rate-limited'], [503, 'server'], [400, 'bad-request'],
  ])('maps HTTP %i to %s without the key in the message', async (status, code) => {
    const error = await transcribeGroq(audio, { key: KEY }, async () => reply(status)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GroqError);
    expect((error as GroqError).code).toBe(code);
    expect(String((error as Error).message)).not.toContain(KEY);
  });
  it('a failed fetch is offline; no key never fetches', async () => {
    await expect(transcribeGroq(audio, { key: KEY }, async () => { throw new TypeError('net'); })).rejects.toMatchObject({ code: 'offline' });
    const fetchFn = vi.fn();
    await expect(transcribeGroq(audio, { key: '' }, fetchFn)).rejects.toMatchObject({ code: 'no-key' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
