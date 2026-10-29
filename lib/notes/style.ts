import type { Marker, NoteStyle, Segment } from '../types';
import { formatClock } from '../time';

export const NOTE_STYLES: NoteStyle[] = ['howto', 'bug', 'update', 'meeting', 'general'];

export const STYLE_BLURB: Record<NoteStyle, string> = {
  howto: 'Numbered steps, each with the time it starts.',
  bug: 'Steps to reproduce, what you expected and what happened.',
  update: 'What changed, what’s next and anything blocked.',
  meeting: 'Decisions and action items.',
  general: 'A summary, key points and chapters.',
};

/** Processing's detected-style row: the title, and the line under it (the frame words Bug report only). */
export const DETECTED_TITLE: Record<NoteStyle, string> = {
  howto: 'Looks like a how-to guide', bug: 'Looks like a bug report', update: 'Looks like an update',
  meeting: 'Looks like a meeting', general: 'Looks like general notes',
};
export const DETECTED_BLURB: Record<NoteStyle, string> = {
  ...STYLE_BLURB, bug: 'Notes will have steps, what you expected and what happened.',
};

export interface SectionDef { key: string; heading: string; timed?: boolean }

/** Sections each style adds to the summary; the model returns them under `sections`. */
export const STYLE_SECTIONS: Record<NoteStyle, SectionDef[]> = {
  howto: [{ key: 'steps', heading: 'Steps', timed: true }],
  bug: [
    { key: 'steps', heading: 'Steps to reproduce', timed: true },
    { key: 'expected', heading: 'Expected' },
    { key: 'happened', heading: 'What happened' },
  ],
  update: [{ key: 'changed', heading: 'What changed' }, { key: 'next', heading: 'What’s next' }, { key: 'blocked', heading: 'Blocked' }],
  meeting: [{ key: 'decisions', heading: 'Decisions' }],
  general: [],
};

const DETECT_CHARS = 4000;

/** The short detection call: the start and end of the transcript plus what the user marked. */
export function buildDetectPrompt(segments: Segment[], markers: Marker[]): { system: string; user: string } {
  const lines = segments.map((s) => `[${formatClock(s.start)}] ${s.text}`).join('\n');
  const text = lines.length <= DETECT_CHARS ? lines : `${lines.slice(0, DETECT_CHARS * 0.7)}\n[...]\n${lines.slice(-DETECT_CHARS * 0.3)}`;
  const marks = markers.map((m) => `[${formatClock(m.at)}] ${m.kind}`).join('\n');
  return {
    system: [
      'You read a screen recording transcript and pick how its notes should be written.',
      'Reply with ONLY a JSON object: {"style": "howto" | "bug" | "update" | "meeting" | "general", "title": string}',
      'howto: showing how to do something. bug: reporting something broken. update: progress on work. meeting: several people deciding things. general: anything else.',
      '"title" is a plain title of at most 8 words, in the language of the transcript.',
    ].join('\n'),
    user: [text || '(no speech was transcribed)', ...(marks ? ['', 'Moments the user marked:', marks] : [])].join('\n'),
  };
}

export function parseDetect(parsed: unknown): { style: NoteStyle; title?: string } | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const { style, title } = parsed as { style?: unknown; title?: unknown };
  if (typeof style !== 'string') return null;
  const found = NOTE_STYLES.find((s) => s === style.trim().toLowerCase());
  if (!found) return null;
  return { style: found, ...(typeof title === 'string' && title.trim() ? { title: cleanTitle(title) } : {}) };
}

export function cleanTitle(title: string): string {
  return title.trim().replace(/^["'“”‘’]+|["'“”‘’.]+$/g, '').slice(0, 120);
}

/** Used when the detection call fails: the markers the user dropped say most of it. */
export function guessStyle(markers: Marker[]): NoteStyle {
  if (markers.some((m) => m.kind === 'bug')) return 'bug';
  if (markers.filter((m) => m.kind === 'step').length >= 2) return 'howto';
  return 'general';
}
