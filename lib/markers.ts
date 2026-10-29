import { getRecording, putRecording } from './db';
import { clockElapsed, type RecorderState } from './recorder';
import type { MarkerKind, Recording } from './types';

export const MARKER_LABEL: Record<MarkerKind, string> = { step: 'Step', bug: 'Bug', important: 'Important', question: 'Question' };
export const MARKER_KINDS: MarkerKind[] = ['step', 'bug', 'important', 'question'];

/** Recording time in ms; the clock already excludes pauses. Null when nothing is being recorded. */
export function markerTime(state: RecorderState, now: number): number | null {
  if (state.status !== 'recording' && state.status !== 'paused') return null;
  return Math.max(0, Math.round(clockElapsed(state.clock, now)));
}

/** A note keeps the time its typing started: set on the first character, cleared when the box empties. */
export function noteStart(started: number | null, text: string, elapsed: number): number | null {
  if (!text.trim()) return null;
  return started ?? elapsed;
}

export function withMarker(rec: Recording, id: string, at: number, kind: MarkerKind): Recording {
  return { ...rec, markers: [...rec.markers, { id, at, kind }].sort((a, b) => a.at - b.at) };
}

export const withoutMarker = (rec: Recording, id: string): Recording => ({ ...rec, markers: rec.markers.filter((m) => m.id !== id) });

export function withNote(rec: Recording, id: string, at: number, text: string): Recording {
  return { ...rec, notes: [...rec.notes, { id, at, text }].sort((a, b) => a.at - b.at) };
}

async function update(recordingId: string, change: (rec: Recording) => Recording): Promise<boolean> {
  const rec = await getRecording(recordingId);
  if (!rec) return false;
  await putRecording(change(rec));
  return true;
}

/** Saves a marker on the live recording and returns its id, or null when the recording is gone. */
export async function addMarker(recordingId: string, at: number, kind: MarkerKind): Promise<string | null> {
  const id = crypto.randomUUID();
  return (await update(recordingId, (r) => withMarker(r, id, at, kind))) ? id : null;
}

export const undoMarker = (recordingId: string, id: string) => update(recordingId, (r) => withoutMarker(r, id));

export async function addNote(recordingId: string, at: number, text: string): Promise<boolean> {
  const clean = text.trim();
  if (!clean) return false;
  return update(recordingId, (r) => withNote(r, crypto.randomUUID(), at, clean));
}
