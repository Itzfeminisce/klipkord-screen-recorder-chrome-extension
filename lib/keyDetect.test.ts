import { describe, expect, it } from 'vitest';
import { detectKey, isKeyName, jobsFor, serviceLabel } from './keyDetect';

describe('detectKey', () => {
  it('recognises each prefix', () => {
    expect(detectKey('gsk_test')).toBe('GROQ_API_KEY');
    expect(detectKey('sk-ant-test')).toBe('ANTHROPIC_API_KEY');
    expect(detectKey('sk-or-v1-test')).toBe('OPENROUTER_API_KEY');
    expect(detectKey('sk-test')).toBe('OPENAI_API_KEY');
    expect(detectKey('sk-proj-test')).toBe('OPENAI_API_KEY');
  });

  it('trims the value', () => {
    expect(detectKey('  gsk_test \n')).toBe('GROQ_API_KEY');
  });

  it('returns null for unknown values', () => {
    expect(detectKey('hello')).toBeNull();
    expect(detectKey('')).toBeNull();
    expect(detectKey('   ')).toBeNull();
    expect(detectKey('ab'.repeat(20))).toBeNull();
  });
});

describe('jobsFor and serviceLabel', () => {
  it('Groq covers transcripts and notes; the rest write notes', () => {
    expect(jobsFor('GROQ_API_KEY')).toEqual(['transcripts', 'notes']);
    expect(jobsFor('OPENROUTER_API_KEY')).toEqual(['notes']);
    expect(jobsFor('ANTHROPIC_API_KEY')).toEqual(['notes']);
  });

  it('names services and knows which key names are usable', () => {
    expect(serviceLabel('GROQ_API_KEY')).toBe('Groq');
    expect(serviceLabel('OPENROUTER_API_KEY')).toBe('OpenRouter');
    expect(serviceLabel('SOMETHING_ELSE')).toBe('SOMETHING_ELSE');
    expect(isKeyName('OPENAI_API_KEY')).toBe(true);
    expect(isKeyName('NOTION_TOKEN')).toBe(false);
  });
});
