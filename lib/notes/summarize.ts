import { getRecording, putRecording } from '../db';
import { loadKeys } from '../keys';
import type { FetchLike } from '../llm';
import { getSettings } from '../settings';
import { formatClock } from '../time';
import type { Chapter, Marker, NoteStyle, NotesEngine, Notes, Recording, Segment, Settings, TimedNote } from '../types';
import { checkChapters, checkTimedLines } from './chapters';
import { availableEngines, type Engine } from './engines';
import { buildDetectPrompt, cleanTitle, guessStyle, parseDetect, STYLE_SECTIONS } from './style';

export const DEFAULT_TITLE = 'Untitled recording';

export class NotesError extends Error {}

/** The start and end of an over-long text with the middle dropped. */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n[... middle of the transcript omitted ...]\n${text.slice(text.length - half)}`;
}

export const transcriptLines = (segments: Segment[]): string[] => segments.map((s) => `[${formatClock(s.start)}] ${s.text}`);

/** Groups lines into chunks of at most `max` characters; a single longer line gets its own chunk. */
export function chunkLines(lines: string[], max: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + line.length + 1 > max) { chunks.push(current); current = ''; }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Closes what a cut-off reply left open and drops trailing commas, then parses. */
export function repairJson(raw: string): unknown {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  if (start < 0) throw new NotesError('The notes came back in a format Klipkord could not read.');
  text = text.slice(start);
  const end = text.lastIndexOf('}');
  const attempts = [end > 0 ? text.slice(0, end + 1) : text, closeOpen(text)];
  for (const candidate of attempts) {
    for (const form of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
      try { return JSON.parse(form); } catch { /* try the next form */ }
    }
  }
  throw new NotesError('The notes came back in a format Klipkord could not read.');
}

function closeOpen(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = inString ? `${text}"` : text;
  out = out.replace(/[,:\s]+$/, '').replace(/"[^"]*"\s*:$/, '');
  return out.replace(/,\s*$/, '') + stack.reverse().join('');
}

const strings = (v: unknown): string[] => {
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
};

export interface ParsedNotes { title?: string; summary: string; points: string[]; actions: string[]; chapters: Chapter[]; sections?: Record<string, string[]> }

/** A model reply → notes. Chapter and step times are checked against the transcript; throws when nothing usable came back. */
export function parseNotes(raw: string, style: NoteStyle, segments: Segment[], durationMs: number): ParsedNotes {
  const o = repairJson(raw) as Record<string, unknown>;
  const rawSections = o.sections && typeof o.sections === 'object' ? (o.sections as Record<string, unknown>) : {};
  const sections: Record<string, string[]> = {};
  for (const def of STYLE_SECTIONS[style]) {
    const lines = def.timed ? checkTimedLines(rawSections[def.key], segments, durationMs) : strings(rawSections[def.key]);
    if (lines.length) sections[def.key] = lines;
  }
  const parsed: ParsedNotes = {
    ...(typeof o.title === 'string' && o.title.trim() ? { title: cleanTitle(o.title) } : {}),
    summary: typeof o.summary === 'string' ? o.summary.trim() : '',
    points: strings(o.points),
    actions: strings(o.actions),
    chapters: checkChapters(o.chapters, segments, durationMs),
    ...(Object.keys(sections).length ? { sections } : {}),
  };
  if (!parsed.summary && !parsed.points.length && !parsed.actions.length && !parsed.chapters.length && !parsed.sections) {
    throw new NotesError('The notes came back empty.');
  }
  return parsed;
}

const STYLE_HINT: Record<NoteStyle, string> = {
  howto: 'a how-to guide: "steps" are the actions shown, in order, each with the time it starts.',
  bug: 'a bug report: "steps" reproduce the problem, "expected" is what should happen, "happened" is what did.',
  update: 'a progress update: "changed" is what changed, "next" is what comes next, "blocked" is anything blocked.',
  meeting: 'a meeting: "decisions" are what was decided; "actions" are the action items.',
  general: 'general notes: a summary, key points and chapters.',
};

export function buildNotesSystem(style: NoteStyle): string {
  const sections = STYLE_SECTIONS[style].map((d) => (d.timed ? `"${d.key}": [{"at": "mm:ss", "text": string}]` : `"${d.key}": string[]`));
  return [
    `You write notes for a screen recording. The notes are ${STYLE_HINT[style]}`,
    'Reply with ONLY a JSON object, no prose, shaped as:',
    `{"title": string (at most 8 words), "summary": string (2-3 sentences), "points": string[], "actions": string[], "chapters": [{"at": "mm:ss", "title": string}], "sections": {${sections.join(', ')}}}`,
    'Every "at" is a time taken from the [mm:ss] stamps in the transcript. Leave a time out rather than guess one.',
    'Use empty arrays when there is nothing. Write in the language of the transcript.',
  ].join('\n');
}

export function buildNotesUser(title: string, text: string, notes: TimedNote[], markers: Marker[]): string {
  const parts = [`Recording: ${title}`, '', 'Transcript:', text || '(no speech was transcribed)'];
  if (notes.length) parts.push('', "The user's own notes:", ...notes.map((n) => `[${formatClock(n.at)}] ${n.text}`));
  if (markers.length) parts.push('', 'Moments the user marked:', ...markers.map((m) => `[${formatClock(m.at)}] ${m.kind}`));
  return parts.join('\n');
}

const CONDENSE =
  'Condense this part of a transcript into short factual lines. Keep the [mm:ss] time on each line. Reply with plain text only.';

/** The transcript as one text that fits the engine; longer ones are condensed chunk by chunk. */
export async function fitTranscript(
  engine: Engine, segments: Segment[], onChunk: (done: number, total: number) => void, signal?: AbortSignal,
): Promise<string> {
  const text = transcriptLines(segments).join('\n');
  if (text.length <= engine.maxChars) return text;
  const chunks = chunkLines(transcriptLines(segments), engine.maxChars);
  const digests: string[] = [];
  for (const [i, chunk] of chunks.entries()) {
    digests.push((await engine.complete(CONDENSE, chunk, { signal })).trim());
    onChunk(i + 1, chunks.length);
  }
  return truncateMiddle(digests.join('\n'), engine.maxChars);
}

/** Tries each engine in turn; a reply that cannot be parsed is asked for once more. */
export async function writeNotes(
  engines: Engine[], rec: Recording, style: NoteStyle, onProgress: (fraction: number) => void, signal?: AbortSignal,
): Promise<{ parsed: ParsedNotes; engine: Engine }> {
  let lastError: unknown = new NotesError('No engine could write the notes.');
  for (const engine of engines) {
    try {
      const text = await fitTranscript(engine, rec.transcript, (d, t) => onProgress((d / (t + 1)) * 0.8), signal);
      const system = buildNotesSystem(style);
      const user = buildNotesUser(rec.title, text, rec.notes, rec.markers);
      for (let attempt = 0; ; attempt++) {
        try {
          const parsed = parseNotes(await engine.complete(system, user, { json: true, signal }), style, rec.transcript, rec.duration);
          return { parsed, engine };
        } catch (error) {
          if (!(error instanceof NotesError) || attempt >= 1) throw error;
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/** Style and title from the short detection call; the markers decide when every engine fails. */
export async function detectStyle(
  engines: Engine[], rec: Recording, signal?: AbortSignal,
): Promise<{ style: NoteStyle; title?: string }> {
  const { system, user } = buildDetectPrompt(rec.transcript, rec.markers);
  for (const engine of engines) {
    try {
      const found = parseDetect(repairJson(await engine.complete(system, user, { json: true, signal })));
      if (found) return found;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return { style: guessStyle(rec.markers) };
}

// ---- The job: one per recording, shared by Processing and the Notes tab.

export type NotesPhase = 'waiting' | 'style' | 'writing' | 'done' | 'no-engine' | 'failed';

export interface NotesProgress {
  phase: NotesPhase;
  pct: number;                  // 0-100
  style?: NoteStyle;
  suggestedTitle?: string;
  startedAt?: number;           // when writing began, for "About N seconds left"
  engines?: NotesEngine[];      // those that could run, in the order tried
  error?: string;
}

export interface JobDeps {
  getRecording: (id: string) => Promise<Recording | undefined>;
  putRecording: (r: Recording) => Promise<void>;
  getSettings: () => Promise<Settings>;
  loadKeys: () => Promise<Record<string, string>>;
  fetchFn: FetchLike;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  globalObject?: object;
}

const liveDeps = (): JobDeps => ({
  getRecording, putRecording, getSettings, loadKeys,
  fetchFn: (u, i) => fetch(u, i), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now,
});

interface Job { progress: NotesProgress; listeners: Set<() => void>; controller: AbortController }
const jobs = new Map<string, Job>();
const runningIds = new Set<string>();

export const getProgress = (id: string): NotesProgress | undefined => jobs.get(id)?.progress;

export function subscribeNotes(id: string, cb: () => void): () => void {
  const job = jobs.get(id) ?? newJob(id);
  job.listeners.add(cb);
  return () => { jobs.get(id)?.listeners.delete(cb); };
}

function newJob(id: string): Job {
  const job: Job = { progress: { phase: 'waiting', pct: 0 }, listeners: new Set(), controller: new AbortController() };
  jobs.set(id, job);
  return job;
}

/** For tests: forget every job. */
export function resetNotesJobs(): void {
  for (const job of jobs.values()) job.controller.abort();
  jobs.clear();
  runningIds.clear();
}

export interface StartOptions { style?: NoteStyle }

/**
 * Writes the notes for a recording once its transcript is complete. Does nothing if notes exist
 * (unless a style is given, which rewrites them) or a job is already running.
 */
export async function startNotes(id: string, opts: StartOptions = {}, deps: JobDeps = liveDeps()): Promise<void> {
  const existing = jobs.get(id);
  if (!opts.style && (runningIds.has(id) || existing?.progress.phase === 'done')) return;
  existing?.controller.abort();
  const job = existing ?? newJob(id);
  job.controller = new AbortController();
  const { signal } = job.controller;
  const set = (p: Partial<NotesProgress>) => {
    if (signal.aborted) return;
    job.progress = { ...job.progress, ...p };
    job.listeners.forEach((l) => l());
  };
  job.progress = { phase: 'waiting', pct: 0 };
  runningIds.add(id);
  try {
    await run(id, opts, deps, signal, set);
  } catch (error) {
    if (signal.aborted) return;
    console.error('Klipkord: could not write the notes', error);
    set({ phase: 'failed', error: error instanceof Error ? error.message : 'Klipkord could not write the notes.' });
    await markReady(id, deps);
  } finally {
    if (!signal.aborted) runningIds.delete(id);
  }
}


async function markReady(id: string, deps: JobDeps): Promise<void> {
  try {
    const rec = await deps.getRecording(id);
    if (rec && rec.status === 'processing') await deps.putRecording({ ...rec, status: 'ready' });
  } catch (error) {
    console.error('Klipkord: could not update the recording', error);
  }
}

async function applyTitle(id: string, title: string | undefined, deps: JobDeps): Promise<void> {
  if (!title) return;
  const rec = await deps.getRecording(id);
  if (rec && rec.title === DEFAULT_TITLE) await deps.putRecording({ ...rec, title });
}

async function run(id: string, opts: StartOptions, deps: JobDeps, signal: AbortSignal, set: (p: Partial<NotesProgress>) => void) {
  let rec = await deps.getRecording(id);
  if (!rec) throw new NotesError('That recording is not here any more.');
  if (rec.status === 'recording' || rec.status === 'paused') return;
  if (rec.summary && !opts.style) { set({ phase: 'done', pct: 100, style: rec.summary.style }); return; }
  while (rec.transcriptPending) {
    await deps.sleep(1_000);
    if (signal.aborted) return;
    const fresh = await deps.getRecording(id);
    if (!fresh) throw new NotesError('That recording is not here any more.');
    rec = fresh;
  }

  const settings = await deps.getSettings();
  if (!rec.transcript.length) {
    const style = opts.style ?? settings.defaultStyle ?? guessStyle(rec.markers);
    const notes: Notes = { style, detected: style, engine: '', summary: '', points: [], actions: [], chapters: [] };
    await deps.putRecording({ ...rec, summary: notes, status: 'ready' });
    set({ phase: 'done', pct: 100, style });
    return;
  }

  const keys = await deps.loadKeys().catch(() => ({}));
  const engines = await availableEngines({ settings, keys, fetchFn: deps.fetchFn, globalObject: deps.globalObject });
  if (signal.aborted) return;
  set({ engines: engines.map((e) => e.id) });
  if (!engines.length) { set({ phase: 'no-engine' }); await markReady(id, deps); return; }

  let style = opts.style ?? settings.defaultStyle;
  let detected = rec.summary?.detected ?? style;
  let title: string | undefined;
  if (!style) {
    set({ phase: 'style', pct: 10 });
    const found = await detectStyle(engines, rec, signal);
    style = detected = found.style;
    title = found.title;
    await applyTitle(id, title, deps);
  }
  set({ style, ...(title ? { suggestedTitle: title } : {}) });

  set({ phase: 'writing', pct: 25, startedAt: deps.now() });
  const { parsed, engine } = await writeNotes(engines, rec, style, (f) => set({ pct: Math.round(25 + f * 65) }), signal);
  if (signal.aborted) return;
  if (parsed.title && !title) {
    title = parsed.title;
    await applyTitle(id, title, deps);
    set({ suggestedTitle: title });
  }
  const notes: Notes = {
    style, detected: detected ?? style, engine: engine.id,
    summary: parsed.summary, points: parsed.points, actions: parsed.actions, chapters: parsed.chapters,
    ...(parsed.sections ? { sections: parsed.sections } : {}),
  };
  const fresh = (await deps.getRecording(id)) ?? rec;
  await deps.putRecording({ ...fresh, summary: notes, status: 'ready' });
  set({ phase: 'done', pct: 100 });
}

/** "About 30 seconds left" once there is enough progress to estimate from; null before that. */
export function etaText(progress: NotesProgress, now: number): string | null {
  if (progress.phase !== 'writing' || progress.startedAt === undefined || progress.pct <= 30) return null;
  const done = (progress.pct - 25) / 65;
  const seconds = ((now - progress.startedAt) * (1 - done)) / done / 1000;
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 90) return `About ${Math.max(5, Math.round(seconds / 5) * 5)} seconds left`;
  return `About ${Math.round(seconds / 60)} minutes left`;
}
