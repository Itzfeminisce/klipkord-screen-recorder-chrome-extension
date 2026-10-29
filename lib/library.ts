import { editedLength } from './editList';
import type { NoteStyle, Recording } from './types';

/** Chip and filter labels from the Library frame. */
export const CHIP_LABEL: Record<NoteStyle, string> = { howto: 'How-to', bug: 'Bug report', update: 'Update', meeting: 'Meeting', general: 'General' };
export const CHIP_COLORS: Record<NoteStyle, { bg: string; fg: string }> = {
  howto: { bg: '#EEF2FF', fg: '#3730A3' }, bug: { bg: '#FFF1EA', fg: '#9A3412' }, update: { bg: '#ECFDF3', fg: '#14532D' },
  meeting: { bg: '#F1F1F3', fg: '#44464D' }, general: { bg: '#F1F1F3', fg: '#44464D' },
};
/** The filter chips after "All" (the frame lists four). */
export const FILTERS: NoteStyle[] = ['howto', 'bug', 'update', 'meeting'];

export const styleOf = (r: Recording): NoteStyle | undefined => r.summary?.style;

export function filterByStyle(list: Recording[], style: NoteStyle | 'all'): Recording[] {
  return style === 'all' ? list : list.filter((r) => styleOf(r) === style);
}

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const DAY = 86400000;

export interface Group { key: string; label: string; items: Recording[] }

/** Newest first, grouped by day: Today, then each earlier day of this week, then by month. */
export function groupByDay(list: Recording[], now: number, locale?: string): Group[] {
  const today = startOfDay(now);
  const groups: Group[] = [];
  for (const r of [...list].sort((a, b) => b.createdAt - a.createdAt)) {
    const day = startOfDay(r.createdAt);
    const age = Math.round((today - day) / DAY);
    let key: string;
    let label: string;
    if (age <= 0) { key = 'today'; label = 'Today'; }
    else if (age < 7) { key = 'week'; label = 'This week'; }
    else {
      const d = new Date(r.createdAt);
      key = `${d.getFullYear()}-${d.getMonth()}`;
      label = d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    }
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(r);
    else groups.push({ key, label, items: [r] });
  }
  return groups;
}

/** The line under a title: the time today, the weekday this week, else the date. */
export function whenLabel(createdAt: number, now: number, locale?: string): string {
  const d = new Date(createdAt);
  const age = Math.round((startOfDay(now) - startOfDay(createdAt)) / DAY);
  if (age <= 0) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (age < 7) return d.toLocaleDateString(locale, { weekday: 'short' });
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/** Storage: a video can go once it is in the folder; a recording saved without its video keeps it. */
export const hasSavedVideo = (r: Recording): boolean => !!r.savedTo?.files.some((f) => /(^|\/)video\.(mp4|webm)$/.test(f));

export interface Candidate { rec: Recording; bytes: number }

/** Splits recordings that still hold a video: safe to delete (saved) and not yet saved. */
export function splitDeletable(list: Recording[], sizes: Record<string, number>): { saved: Candidate[]; unsaved: Candidate[] } {
  const saved: Candidate[] = [];
  const unsaved: Candidate[] = [];
  for (const rec of list) {
    const bytes = sizes[rec.id] ?? 0;
    if (bytes <= 0) continue;
    (hasSavedVideo(rec) ? saved : unsaved).push({ rec, bytes });
  }
  return { saved, unsaved };
}

export const totalBytes = (c: Candidate[]): number => c.reduce((n, x) => n + x.bytes, 0);

/** Estimated size of the saved video: the stored size scaled to the kept length. */
export function estimateVideoBytes(rec: Recording): number {
  if (rec.edits.length === 0 || rec.duration <= 0) return rec.bytes;
  return Math.round(rec.bytes * (editedLength(rec.edits, rec.duration) / rec.duration));
}
