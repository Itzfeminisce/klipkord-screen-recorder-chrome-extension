import type { Recording, SearchField, SearchHit } from './types';

/** One searchable piece of a recording: its title, a transcript line, or a note or comment. */
export interface SearchDoc { field: SearchField; at?: number; text: string }

/** In-memory inverted index: folded word to the recordings that hold it, plus each recording's pieces. */
export interface SearchIndex { docs: Map<string, SearchDoc[]>; words: Map<string, Set<string>> }

export const SNIPPET_BEFORE = 40;
export const SNIPPET_AFTER = 80;
export const MAX_HITS_PER_RECORDING = 5;

/** Lower-cases and strips accents per character; `map[i]` is the source offset of folded char i. */
export function fold(text: string): { text: string; map: number[] } {
  let out = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < f.length; k++) map.push(i);
    out += f;
    i += ch.length;
  }
  map.push(i);
  return { text: out, map };
}

const WORD = /[\p{L}\p{N}]+/gu;
export const tokenize = (text: string): string[] => fold(text).text.match(WORD) ?? [];

/** The pieces of a ready recording worth searching; others have none. */
export function docsOf(r: Recording): SearchDoc[] {
  if (r.status !== 'ready') return [];
  const docs: SearchDoc[] = [{ field: 'title', text: r.title }];
  for (const s of r.transcript) docs.push({ field: 'transcript', at: s.start, text: s.text });
  const note = (text: string | undefined, at?: number) => { if (text?.trim()) docs.push({ field: 'notes', ...(at === undefined ? {} : { at }), text }); };
  const sum = r.summary;
  if (sum) {
    note(sum.summary);
    [...sum.points, ...sum.actions].forEach((t) => note(t));
    sum.chapters.forEach((c) => note(c.title, c.at));
  }
  r.notes.forEach((n) => note(n.text, n.at));
  r.comments.forEach((c) => note(c.text, c.at));
  return docs;
}

export const createIndex = (): SearchIndex => ({ docs: new Map(), words: new Map() });

export function removeRecording(index: SearchIndex, id: string): void {
  const old = index.docs.get(id);
  if (!old) return;
  index.docs.delete(id);
  for (const d of old) {
    for (const w of tokenize(d.text)) {
      const ids = index.words.get(w);
      if (ids) {
        ids.delete(id);
        if (ids.size === 0) index.words.delete(w);
      }
    }
  }
}

/** Adds or replaces one recording's pieces. */
export function indexDocs(index: SearchIndex, id: string, docs: SearchDoc[]): void {
  removeRecording(index, id);
  if (docs.length === 0) return;
  index.docs.set(id, docs);
  for (const d of docs) {
    for (const w of tokenize(d.text)) {
      let ids = index.words.get(w);
      if (!ids) index.words.set(w, (ids = new Set()));
      ids.add(id);
    }
  }
}
export const indexRecording = (index: SearchIndex, r: Recording): void => indexDocs(index, r.id, docsOf(r));

/** Recording ids that hold every query word; the last word may be a prefix (search as you type). */
function candidates(index: SearchIndex, words: string[]): Set<string> {
  let result: Set<string> | undefined;
  words.forEach((q, n) => {
    const last = n === words.length - 1;
    const found = new Set<string>();
    for (const [w, ids] of index.words) if (w === q || (last && w.startsWith(q))) ids.forEach((id) => found.add(id));
    result = result ? new Set([...result].filter((id) => found.has(id))) : found;
  });
  return result ?? new Set();
}

/** Source range of the earliest query word found in `text`, or null when any word is missing. */
function firstMatch(text: string, words: string[]): [number, number] | null {
  const f = fold(text);
  const spans = [...f.text.matchAll(WORD)].map((m) => ({ w: m[0], s: m.index ?? 0 }));
  let first: [number, number] | null = null;
  for (let n = 0; n < words.length; n++) {
    const q = words[n]!;
    const last = n === words.length - 1;
    const span = spans.find((x) => x.w === q || (last && x.w.startsWith(q)));
    if (!span) return null;
    const range: [number, number] = [f.map[span.s]!, f.map[span.s + q.length]!];
    if (!first || range[0] < first[0]) first = range;
  }
  return first;
}

/** A bounded window around the match, cut at word edges, with the match range inside the snippet. */
export function snippetOf(text: string, match: [number, number]): { snippet: string; match: [number, number] } {
  let from = Math.max(0, match[0] - SNIPPET_BEFORE);
  let to = Math.min(text.length, match[1] + SNIPPET_AFTER);
  if (from > 0) { const sp = text.indexOf(' ', from); if (sp !== -1 && sp < match[0]) from = sp + 1; }
  if (to < text.length) { const sp = text.lastIndexOf(' ', to); if (sp > match[1]) to = sp; }
  const lead = from > 0 ? '…' : '';
  const tail = to < text.length ? '…' : '';
  return { snippet: lead + text.slice(from, to) + tail, match: [lead.length + match[0] - from, lead.length + match[1] - from] };
}

/** Hits grouped by recording (ids in `order` first), at most MAX_HITS_PER_RECORDING each. */
export function search(index: SearchIndex, query: string, order: string[] = []): SearchHit[] {
  const words = tokenize(query);
  if (words.length === 0) return [];
  const ids = candidates(index, words);
  const ranked = [...order.filter((id) => ids.has(id)), ...[...ids].filter((id) => !order.includes(id))];
  const hits: SearchHit[] = [];
  for (const id of ranked) {
    let n = 0;
    for (const d of index.docs.get(id) ?? []) {
      if (n >= MAX_HITS_PER_RECORDING) break;
      const m = firstMatch(d.text, words);
      if (!m) continue;
      n++;
      hits.push({ recordingId: id, field: d.field, ...(d.at === undefined ? {} : { at: d.at }), ...snippetOf(d.text, m) });
    }
  }
  return hits;
}
