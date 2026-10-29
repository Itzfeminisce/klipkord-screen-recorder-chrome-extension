import type { Segment } from './types';

export interface FillerHit { start: number; end: number; text: string }

const SINGLE = new Set(['um', 'uh', 'er']);
const token = (text: string) => text.toLowerCase().replace(/[^a-z']/g, '');

/** English fillers from word timings: um, uh, er, "you know", and "like" only when it opens a phrase. */
export function findFillers(segments: Segment[]): FillerHit[] {
  const out: FillerHit[] = [];
  for (const seg of segments) {
    const words = seg.words ?? [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      const t = token(w.text);
      const opensPhrase = i === 0 || /[.!?…]$/.test(words[i - 1]!.text.trim());
      if (SINGLE.has(t) || (t === 'like' && opensPhrase)) out.push({ start: w.start, end: w.end, text: t });
      else if (t === 'you' && token(words[i + 1]?.text ?? '') === 'know') {
        out.push({ start: w.start, end: words[i + 1]!.end, text: 'you know' });
        i++;
      }
    }
  }
  return out;
}
