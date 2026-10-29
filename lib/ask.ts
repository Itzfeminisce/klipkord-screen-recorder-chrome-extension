import { availableEngines, type Engine, type EngineDeps } from './notes/engines';
import { formatClock } from './time';
import type { AskAnswer, Segment } from './types';

export const NO_ANSWER_TOKEN = 'NO_ANSWER';

export const ASK_SYSTEM_PROMPT = [
  'You answer questions about one screen recording, using only the transcript you are given.',
  'Never use outside knowledge.',
  `If the transcript does not answer the question, reply with exactly ${NO_ANSWER_TOKEN} and nothing else.`,
  'Cite every moment you rely on as [mm:ss] (or [h:mm:ss]) using the timestamps at the start of transcript lines.',
  'Be brief. Use short sentences or a short list.',
].join(' ');

/** Slack around a segment when matching a cited time to it. */
export const TIME_TOLERANCE_MS = 2_000;

export function buildAskPrompt(title: string, segments: Segment[], question: string, maxChars = 30_000): { system: string; user: string } {
  let lines = segments.map((s) => `[${formatClock(s.start)}] ${s.text}`).join('\n');
  if (lines.length > maxChars) {
    const half = Math.floor(maxChars / 2);
    lines = `${lines.slice(0, half)}\n[... middle of the transcript omitted ...]\n${lines.slice(lines.length - half)}`;
  }
  return { system: ASK_SYSTEM_PROMPT, user: `Recording: ${title}\n\nTranscript:\n${lines}\n\nQuestion: ${question.trim()}` };
}

const CITATION = /\[(\d{1,3}):(\d{2})(?::(\d{2}))?\]/g;

function toMs(a: string, b: string, c: string | undefined): number | null {
  const [x, y, z] = [Number(a), Number(b), c === undefined ? undefined : Number(c)];
  if (y >= 60 || (z !== undefined && z >= 60)) return null;
  return (z === undefined ? x * 60 + y : x * 3600 + y * 60 + z) * 1000;
}

/** Unique [m:ss] / [h:mm:ss] citations of an answer, in ms, in order of appearance. */
export function parseTimes(answer: string): number[] {
  const out: number[] = [];
  for (const m of answer.matchAll(CITATION)) {
    const ms = toMs(m[1] ?? '', m[2] ?? '', m[3]);
    if (ms !== null && !out.includes(ms)) out.push(ms);
  }
  return out;
}

const covers = (s: Segment, t: number) => t >= s.start - TIME_TOLERANCE_MS && t <= s.end + TIME_TOLERANCE_MS;

/** Keeps only times that fall in a transcript line; sources are the lines they fall in. */
export function checkTimes(times: number[], transcript: Segment[]): { times: number[]; sources: Segment[] } {
  const kept = times.filter((t) => transcript.some((s) => covers(s, t)));
  const sources: Segment[] = [];
  for (const t of kept) {
    const s = transcript.find((x) => covers(x, t));
    if (s && !sources.includes(s)) sources.push(s);
  }
  return { times: kept, sources };
}

/** Removes citations the transcript does not back, so no invented time shows. */
export function stripUnsupported(answer: string, valid: number[]): string {
  return answer.replace(new RegExp(`\\s*${CITATION.source}`, 'g'), (whole, a, b, c) => {
    const ms = toMs(a, b, c);
    return ms !== null && valid.includes(ms) ? whole : '';
  }).trim();
}

export type AskResult =
  | { kind: 'answer'; answer: AskAnswer }
  | { kind: 'not-set-up' }   // ask-ai-not-set-up
  | { kind: 'no-answer' };   // ask-no-answer

export const ENGINE_FOOTER: Record<string, string> = {
  builtin: 'Answered on this computer by Chrome’s built-in AI.',
  ollama: 'Answered on this computer by Ollama.',
  groq: 'Answered by Groq.',
};

/** Asks the first engine that can answer. An answer with no time the transcript backs counts as no answer. */
export async function askRecording(
  title: string, transcript: Segment[], question: string, deps: EngineDeps, signal?: AbortSignal,
): Promise<AskResult> {
  const engines: Engine[] = await availableEngines(deps);
  if (!engines.length) return { kind: 'not-set-up' };
  for (const engine of engines) {
    const { system, user } = buildAskPrompt(title, transcript, question, engine.maxChars);
    let raw: string;
    try { raw = (await engine.complete(system, user, { signal })).trim(); } catch (error) {
      if (signal?.aborted) throw error;
      console.error('Klipkord: could not ask the AI', error);
      continue;
    }
    if (!raw || raw.includes(NO_ANSWER_TOKEN)) return { kind: 'no-answer' };
    const { times, sources } = checkTimes(parseTimes(raw), transcript);
    if (!times.length) return { kind: 'no-answer' };
    return { kind: 'answer', answer: { text: stripUnsupported(raw, times), times, sources, engine: engine.id } };
  }
  return { kind: 'no-answer' };
}
