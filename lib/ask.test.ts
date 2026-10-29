import { describe, expect, it, vi } from 'vitest';
import { askRecording, buildAskPrompt, checkTimes, parseTimes, stripUnsupported } from './ask';
import type { Segment } from './types';

const transcript: Segment[] = [
  { start: 221_000, end: 226_000, text: 'It freezes in Safari.' },
  { start: 235_000, end: 240_000, text: 'Chrome works fine.' },
];
const json = (body: unknown) => new Response(JSON.stringify(body));
const down = async (): Promise<Response> => { throw new TypeError('offline'); };
const ollama = (content: string) => vi.fn(async (url: string) => (url.endsWith('/api/tags') ? json({ models: [{ name: 'llama3.2' }] }) : json({ message: { content } })));
type Deps = Parameters<typeof askRecording>[3];
const deps = (fetchFn: Deps['fetchFn'], keys: Record<string, string> = {}): Deps => ({ settings: { notesEngine: 'ollama' }, keys, fetchFn, globalObject: {} });

describe('time check', () => {
  it('parses unique m:ss and h:mm:ss times', () => {
    expect(parseTimes('At [03:41] and [03:41], later [1:02:03], bad [03:75].')).toEqual([221_000, 3_723_000]);
  });
  it('drops invented times and keeps the lines behind real ones', () => {
    const r = checkTimes([221_000, 600_000], transcript);
    expect(r.times).toEqual([221_000]);
    expect(r.sources).toEqual([transcript[0]]);
  });
  it('strips unsupported citations from the text', () => {
    expect(stripUnsupported('Safari [03:41]. Firefox [10:00].', [221_000])).toBe('Safari [03:41]. Firefox.');
  });
});

describe('buildAskPrompt', () => {
  it('puts timed lines and the question in the user message and the rules in system', () => {
    const p = buildAskPrompt('Checkout', transcript, ' Which browsers? ');
    expect(p.system).toContain('using only the transcript');
    expect(p.user).toContain('[03:41] It freezes in Safari.');
    expect(p.user).toContain('Question: Which browsers?');
  });
  it('shortens an over-long transcript in the middle', () => {
    expect(buildAskPrompt('t', transcript, 'q', 40).user).toContain('middle of the transcript omitted');
  });
});

describe('askRecording', () => {
  it('answers through Ollama with checked times', async () => {
    const r = await askRecording('t', transcript, 'q', deps(ollama('Safari froze [03:41]; Chrome did not [03:55]; maybe [09:00].')));
    expect(r).toMatchObject({ kind: 'answer', answer: { times: [221_000, 235_000], engine: 'ollama' } });
    if (r.kind === 'answer') expect(r.answer.text).not.toContain('09:00');
  });
  it('answers through Groq with an injected fetch', async () => {
    const fetchFn = vi.fn(async () => json({ choices: [{ message: { content: 'Safari [03:41]' } }] }));
    const r = await askRecording('t', transcript, 'q', { ...deps(fetchFn, { GROQ_API_KEY: 'gsk_test' }), settings: { notesEngine: 'groq' } });
    expect(r).toMatchObject({ kind: 'answer', answer: { engine: 'groq' } });
  });
  it('answers through built-in AI', async () => {
    const prompt = vi.fn(async () => 'Safari [03:41]');
    const globalObject = { LanguageModel: { availability: async () => 'available', create: async () => ({ prompt, destroy() {} }) } };
    const r = await askRecording('t', transcript, 'q', { ...deps(down), settings: { notesEngine: 'builtin' }, globalObject });
    expect(r).toMatchObject({ kind: 'answer', answer: { engine: 'builtin' } });
  });
  it('says not set up when no engine is ready', async () => {
    expect(await askRecording('t', transcript, 'q', deps(down))).toEqual({ kind: 'not-set-up' });
  });
  it('says no answer for NO_ANSWER or only invented times', async () => {
    expect(await askRecording('t', transcript, 'q', deps(ollama('NO_ANSWER')))).toEqual({ kind: 'no-answer' });
    expect(await askRecording('t', transcript, 'q', deps(ollama('It was Safari [09:00].')))).toEqual({ kind: 'no-answer' });
  });
});
