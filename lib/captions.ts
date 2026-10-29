import { keptRanges, toEdited } from './editList';
import type { KeptRange, Segment } from './types';

export interface Cue { start: number; end: number; text: string }   // ms, edited time

/** Transcript lines on the edited timeline: cut parts are dropped, lines that straddle a cut are clipped. */
export function captionCues(segments: Segment[], edits: KeptRange[], duration: number): Cue[] {
  const kept = keptRanges(edits, duration);
  const cues: Cue[] = [];
  for (const seg of [...segments].sort((a, b) => a.start - b.start)) {
    const text = seg.text.trim();
    if (!text) continue;
    for (const r of kept) {
      const start = Math.max(seg.start, r.start);
      const end = Math.min(seg.end, r.end);
      if (end <= start) continue;
      const from = toEdited(edits, duration, start);
      cues.push({ start: from, end: from + (end - start), text });
    }
  }
  return cues;
}

function stamp(ms: number, sep: ',' | '.'): string {
  const t = Math.max(0, Math.round(ms));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(t / 3600000))}:${p(Math.floor(t / 60000) % 60)}:${p(Math.floor(t / 1000) % 60)}${sep}${p(t % 1000, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`).join('\n');
}

export function toVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`).join('\n')}`;
}

export type CaptionFormat = 'srt' | 'vtt';

export function buildCaptions(segments: Segment[], edits: KeptRange[], duration: number, format: CaptionFormat): string {
  const cues = captionCues(segments, edits, duration);
  return format === 'srt' ? toSrt(cues) : toVtt(cues);
}
