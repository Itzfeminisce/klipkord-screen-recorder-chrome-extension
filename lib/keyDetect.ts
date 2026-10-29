/** Recognises a pasted key by its prefix. Never logs or returns the value itself. */

export type KeyName = 'GROQ_API_KEY' | 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'OPENROUTER_API_KEY';

export type KeyJob = 'transcripts' | 'notes';

/** The key name for a pasted value, or null when Klipkord doesn't recognise it. Longer prefixes win over `sk-`. */
export function detectKey(value: string): KeyName | null {
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith('gsk_')) return 'GROQ_API_KEY';
  if (v.startsWith('sk-ant-')) return 'ANTHROPIC_API_KEY';
  if (v.startsWith('sk-or-')) return 'OPENROUTER_API_KEY';
  if (v.startsWith('sk-')) return 'OPENAI_API_KEY';
  return null;
}

/** What a key covers in Klipkord: Groq does transcripts and notes; the others write notes. */
export function jobsFor(name: KeyName): KeyJob[] {
  return name === 'GROQ_API_KEY' ? ['transcripts', 'notes'] : ['notes'];
}

const LABELS: Record<KeyName, string> = {
  GROQ_API_KEY: 'Groq',
  OPENROUTER_API_KEY: 'OpenRouter',
  OPENAI_API_KEY: 'OpenAI',
  ANTHROPIC_API_KEY: 'Anthropic',
};

/** The service's display name for a key name ("Groq"); unknown names come back unchanged. */
export function serviceLabel(name: string): string {
  return LABELS[name as KeyName] ?? name;
}

/** True for a key name Klipkord can use. */
export function isKeyName(name: string): name is KeyName {
  return name in LABELS;
}
