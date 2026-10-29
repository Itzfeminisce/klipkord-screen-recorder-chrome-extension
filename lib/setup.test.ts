import { describe, expect, it, vi } from 'vitest';
import {
  builtinAiPresent, canStart, classifyPaste, cloudSettings, detectMachine, isFirstRun, missingKeys, notesOptions,
  penvRowStatus, requestAccess, setupChoice, transcriptsStatus,
} from './setup';

describe('setupChoice', () => {
  it('picks this computer when WebGPU and built-in AI both work', () => {
    expect(setupChoice({ webgpu: true, builtinAi: true })).toEqual({ ai: 'local', notesEngine: 'builtin', states: [] });
  });

  it('picks Groq and shows slow-computer without WebGPU', () => {
    expect(setupChoice({ webgpu: false, builtinAi: true })).toEqual({ ai: 'cloud', notesEngine: 'groq', states: ['slow-computer'] });
  });

  it('falls back to Ollama for notes and shows no-built-in-ai', () => {
    expect(setupChoice({ webgpu: true, builtinAi: false })).toEqual({ ai: 'local', notesEngine: 'ollama', states: ['no-built-in-ai'] });
  });

  it('handles both missing (the owner’s machine)', () => {
    expect(setupChoice({ webgpu: false, builtinAi: false })).toEqual({ ai: 'cloud', notesEngine: 'groq', states: ['no-built-in-ai', 'slow-computer'] });
  });

  it('assumes nothing while the check is running', () => {
    expect(setupChoice({ webgpu: null, builtinAi: null })).toEqual({ ai: 'local', notesEngine: 'builtin', states: [] });
  });
});

describe('detectMachine', () => {
  it('reads WebGPU and built-in AI availability', async () => {
    const env = {
      gpu: { requestAdapter: async () => ({}) },
      summarizer: { availability: vi.fn(async (_options?: { outputLanguage?: string }) => 'downloadable') },
      languageModel: { availability: async () => 'unavailable' },
    };
    expect(await detectMachine(env)).toEqual({ webgpu: true, builtinAi: true });
    expect(env.summarizer.availability).toHaveBeenCalledWith({ outputLanguage: 'en' });
  });

  it('counts absent APIs, a null adapter and throwing probes as missing', async () => {
    expect(await detectMachine({})).toEqual({ webgpu: false, builtinAi: false });
    const env = {
      gpu: { requestAdapter: async () => null },
      summarizer: { availability: async () => { throw new Error('no'); } },
      languageModel: { availability: async () => 'unavailable' },
    };
    expect(await detectMachine(env)).toEqual({ webgpu: false, builtinAi: false });
  });

  it('either built-in API is enough', () => {
    expect(builtinAiPresent(undefined, 'available')).toBe(true);
    expect(builtinAiPresent('unavailable', undefined)).toBe(false);
  });
});

describe('isFirstRun', () => {
  it('is true only with no key source, no recordings and nothing confirmed', () => {
    expect(isFirstRun({ keySource: null }, 0)).toBe(true);
    expect(isFirstRun({ keySource: null, onboarded: true }, 0)).toBe(false);
    expect(isFirstRun({ keySource: 'paste' }, 0)).toBe(false);
    expect(isFirstRun({ keySource: null }, 2)).toBe(false);
  });
});

describe('keys', () => {
  it('describes a pasted key', () => {
    expect(classifyPaste('gsk_test')).toEqual({ kind: 'known', name: 'GROQ_API_KEY', title: 'This is a Groq key', jobs: 'Covers transcripts and notes' });
    expect(classifyPaste('sk-or-test')).toMatchObject({ title: 'This is a OpenRouter key', jobs: 'Covers notes' });
    expect(classifyPaste('nope')).toEqual({ kind: 'unknown' });
    expect(classifyPaste('  ')).toEqual({ kind: 'empty' });
  });

  it('allows Start recording once a usable key works', () => {
    expect(canStart([], {})).toBe(false);
    expect(canStart(['GROQ_API_KEY'], { GROQ_API_KEY: 'checking' })).toBe(false);
    expect(canStart(['GROQ_API_KEY'], { GROQ_API_KEY: 'rejected' })).toBe(false);
    expect(canStart(['GROQ_API_KEY'], { GROQ_API_KEY: 'ok' })).toBe(true);
    expect(canStart(['NOTION_TOKEN'], { NOTION_TOKEN: 'ok' })).toBe(false);
  });

  it('turns cloud AI on only for a working Groq key', () => {
    expect(cloudSettings(['GROQ_API_KEY'], { GROQ_API_KEY: 'ok' })).toEqual({ ai: 'cloud', notesEngine: 'groq' });
    expect(cloudSettings(['OPENAI_API_KEY'], { OPENAI_API_KEY: 'ok' })).toBeNull();
    expect(missingKeys(['GROQ_API_KEY'], ['OPENAI_API_KEY'])).toEqual(['GROQ_API_KEY']);
  });
});

describe('settings rows', () => {
  it('words the transcripts, penv and notes rows', () => {
    expect(transcriptsStatus('local', true)).toBe('Whisper · downloaded');
    expect(transcriptsStatus('cloud')).toBe('Groq');
    expect(penvRowStatus(true, 1)).toBe('Connected · 1 key');
    expect(penvRowStatus(true, 2)).toBe('Connected · 2 keys');
    expect(penvRowStatus(false, 0)).toBeNull();
    expect(notesOptions('local').map((o) => o.value)).toEqual(['builtin', 'ollama']);
    expect(notesOptions('cloud').map((o) => o.value)).toEqual(['builtin', 'ollama', 'groq']);
  });
});

describe('requestAccess', () => {
  const stream = { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
  const media = (allow: (c: MediaStreamConstraints) => boolean) => ({
    getUserMedia: async (c?: MediaStreamConstraints) => { if (!allow(c ?? {})) throw new Error('denied'); return stream; },
  });

  it('asks for both and reports camera true', async () => {
    expect(await requestAccess(true, media(() => true))).toEqual({ mic: true, camera: true });
  });

  it('mic only never asks for video', async () => {
    const seen: MediaStreamConstraints[] = [];
    await requestAccess(false, media((c) => { seen.push(c); return true; }));
    expect(seen).toEqual([{ audio: true }]);
  });

  it('keeps the mic when the camera is refused', async () => {
    expect(await requestAccess(true, media((c) => !c.video))).toEqual({ mic: true, camera: false });
    expect(await requestAccess(true, media(() => false))).toEqual({ mic: false, camera: false });
  });
});
