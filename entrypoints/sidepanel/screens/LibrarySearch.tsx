import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { backfillSearchIndex, listRecordings, listSearchEntries } from '@/lib/db';
import { CHIP_COLORS, CHIP_LABEL, styleOf, whenLabel } from '@/lib/library';
import { createIndex, indexDocs, search } from '@/lib/search';
import { formatClock } from '@/lib/time';
import type { Recording, SearchField, SearchHit } from '@/lib/types';
import { useRouter } from '../router';

const MONO = "var(--mono, 'Geist Mono', monospace)";
const LABEL: Record<SearchField, string> = { title: 'Title', transcript: 'Transcript', notes: 'Notes' };
const MARK = { background: '#FFE2CF', color: '#111114', borderRadius: 3, padding: '0 1px' } as const;

function Marked({ text, match }: { text: string; match: [number, number] }): ReactNode {
  return <>{text.slice(0, match[0])}<mark style={MARK}>{text.slice(match[0], match[1])}</mark>{text.slice(match[1])}</>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function LibrarySearch() {
  const { navigate, back } = useRouter();
  const [query, setQuery] = useState('');
  const [recs, setRecs] = useState<Recording[]>([]);
  const [index, setIndex] = useState(createIndex);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [entries, all] = await Promise.all([listSearchEntries(), listRecordings()]);
      if (!live) return;
      const next = createIndex();
      entries.forEach((e) => indexDocs(next, e.id, e.docs));
      setIndex(next);
      setRecs(all.filter((r) => r.status === 'ready'));
    };
    void (async () => {
      await load();
      await backfillSearchIndex((done, total) => { if (live) setProgress(done < total ? { done, total } : null); });
      await load();
    })().catch((error) => console.error('Klipkord: could not prepare search', error));
    return () => { live = false; };
  }, []);

  const hits = useMemo(() => search(index, query, recs.map((r) => r.id)), [index, query, recs]);
  const groups = useMemo(() => {
    const byId = new Map<string, SearchHit[]>();
    hits.forEach((h) => byId.set(h.recordingId, [...(byId.get(h.recordingId) ?? []), h]));
    return recs.filter((r) => byId.has(r.id)).map((r) => ({ rec: r, hits: byId.get(r.id)! }));
  }, [hits, recs]);

  const now = Date.now();
  const searching = query.trim() !== '';
  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 16px 0 16px' }}>
        <button type="button" aria-label="Back to library" onClick={back} style={{ width: 44, height: 44, border: 'none', borderRadius: 12, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111114', cursor: 'pointer' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <label style={{ flexGrow: 1, minWidth: 0, height: 44, padding: '0 6px 0 14px', borderRadius: 12, background: '#FFFFFF', border: '2px solid #C2410C', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10, color: '#6E7079' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input type="search" aria-label="Search all recordings" autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            style={{ flexGrow: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', font: 'inherit', fontSize: 14, color: '#111114' }} />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} style={{ width: 32, height: 32, border: 'none', borderRadius: 8, background: 'transparent', color: '#5F6168', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          )}
        </label>
      </div>

      {searching && hits.length > 0 && (
        <p style={{ margin: 0, padding: '12px 24px 0', fontSize: 12, fontWeight: 500, color: '#6E7079' }}>{plural(hits.length, 'match', 'matches')} in {plural(groups.length, 'recording', 'recordings')}</p>
      )}

      <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '10px 16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {progress && (
          <div style={{ padding: 14, borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#FFF7E6', color: '#92400E', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Still getting older recordings ready</span>
                <span style={{ fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>{progress.done} of {progress.total} recordings can be searched so far. Results from the rest will show up here as they finish.</span>
              </span>
            </div>
            <span role="progressbar" aria-label="Recordings ready to search" aria-valuenow={Math.round((progress.done / progress.total) * 100)} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 999, background: '#F1F1F3', overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${(progress.done / progress.total) * 100}%`, height: '100%', background: '#111114' }} />
            </span>
          </div>
        )}

        {searching && hits.length === 0 && (
          <div style={{ padding: 14, borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#F1F1F3', color: '#44464D', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>No matches for “{query.trim()}”</span>
                <span style={{ fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>Nothing in your titles, transcripts or notes has that word. Check the spelling, or try a shorter word.</span>
              </span>
            </div>
            <button type="button" onClick={() => setQuery('')} style={{ alignSelf: 'flex-start', height: 36, padding: '0 14px', border: 'none', borderRadius: 10, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Clear search</button>
          </div>
        )}

        {groups.map(({ rec, hits: gh }) => {
          const style = styleOf(rec);
          const titleHit = gh.find((h) => h.field === 'title');
          return (
            <div key={rec.id} style={{ borderRadius: 14, background: '#FFFFFF', border: '1px solid #E8E8EB', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{titleHit ? <Marked text={titleHit.snippet} match={titleHit.match} /> : rec.title}</span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#6E7079' }}>
                  {style && <span style={{ padding: '1px 6px', borderRadius: 999, background: CHIP_COLORS[style].bg, color: CHIP_COLORS[style].fg, fontWeight: 600 }}>{CHIP_LABEL[style]}</span>}
                  {whenLabel(rec.createdAt, now)}
                </span>
              </div>
              {gh.map((h, i) => (
                <button key={i} type="button" onClick={() => navigate('Review', { recordingId: rec.id, ...(h.at === undefined ? {} : { atMs: h.at }) })}
                  style={{ padding: '10px 12px', minHeight: 44, boxSizing: 'border-box', border: 'none', borderTop: '1px solid #E8E8EB', background: 'transparent', color: '#111114', font: 'inherit', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, color: '#5F6168', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    <span>{LABEL[h.field]}</span>
                    {h.field === 'transcript' && h.at !== undefined && <span style={{ fontFamily: MONO, fontSize: 12, color: '#C2410C', fontWeight: 500, textTransform: 'none' }}>{formatClock(h.at)}</span>}
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.45 }}><Marked text={h.snippet} match={h.match} /></span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div style={{ padding: '10px 16px 16px', fontSize: 12, color: '#6E7079' }}>Searched on this computer. Nothing leaves it.</div>
    </main>
  );
}
