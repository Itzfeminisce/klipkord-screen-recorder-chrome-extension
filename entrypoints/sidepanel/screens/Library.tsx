import { useEffect, useMemo, useState } from 'react';
import { listRecordings } from '@/lib/db';
import { CHIP_COLORS, CHIP_LABEL, FILTERS, filterByStyle, groupByDay, styleOf, whenLabel } from '@/lib/library';
import { freeBytes, isDiskLow } from '@/lib/storageMath';
import { formatBytes, formatClock } from '@/lib/time';
import type { NoteStyle, Recording } from '@/lib/types';
import { videoStore } from '@/lib/videoStore';
import { Spinner } from '../components';
import { useRouter } from '../router';
import { BackBar } from './Export';
import LibraryEmpty from './LibraryEmpty';

const MONO = "var(--mono, 'Geist Mono', monospace)";

function Thumb({ blob, length }: { blob?: Blob; length: number }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <span style={{ width: 96, height: 56, borderRadius: 8, background: '#26262B', position: 'relative', flexShrink: 0, overflow: 'hidden' }}>
      {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      <span style={{ position: 'absolute', right: 4, bottom: 4, padding: '1px 4px', borderRadius: 4, background: 'rgba(17,17,20,0.8)', color: '#FFFFFF', fontFamily: MONO, fontSize: 10 }}>{formatClock(length)}</span>
    </span>
  );
}

export default function Library() {
  const { navigate, replace } = useRouter();
  const [list, setList] = useState<Recording[] | undefined>();
  const [filter, setFilter] = useState<NoteStyle | 'all'>('all');
  const [space, setSpace] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    listRecordings().then((all) => setList(all.filter((r) => r.status === 'ready')), (error) => { console.error('Klipkord: could not list the recordings', error); setList([]); });
    videoStore.usage().then(setSpace, (error) => console.error('Klipkord: could not read storage use', error));
  }, []);

  const now = Date.now();
  const groups = useMemo(() => groupByDay(filterByStyle(list ?? [], filter), now), [list, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!list) return <main className="screen screen-center"><Spinner /></main>;
  if (list.length === 0) return <LibraryEmpty />;

  const chip = (value: NoteStyle | 'all', label: string) => {
    const on = filter === value;
    return (
      <button key={value} type="button" role="radio" aria-checked={on} onClick={() => setFilter(value)}
        style={{ height: 32, padding: '0 12px', border: on ? 'none' : '1px solid #E8E8EB', borderRadius: 999, background: on ? '#111114' : '#FFFFFF', color: on ? '#FFFFFF' : '#44464D', font: 'inherit', fontSize: 12, fontWeight: on ? 600 : 500, cursor: 'pointer' }}>{label}</button>
    );
  };
  const free = space ? freeBytes(space) : 0;
  const pct = space && space.quota > 0 ? Math.min(100, Math.round((space.usage / space.quota) * 100)) : 0;

  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      <BackBar label="Back to recorder" onBack={() => replace('Home')} title="Library" right={
        <button type="button" onClick={() => replace('Home')} style={{ height: 36, padding: '0 12px', border: 'none', borderRadius: 10, background: '#C2410C', color: '#FFFFFF', font: 'inherit', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FFFFFF' }} />New
        </button>
      } />

      <div role="radiogroup" aria-label="Filter by style" style={{ padding: '12px 24px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {chip('all', `All · ${list.length}`)}
        {FILTERS.map((s) => chip(s, CHIP_LABEL[s]))}
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {groups.map((g, gi) => (
          <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ padding: gi ? '8px 8px 0' : '0 8px', fontSize: 12, fontWeight: 500, color: '#6E7079' }}>{g.label}</span>
            {g.items.map((r) => {
              const style = styleOf(r);
              return (
                <button key={r.id} type="button" onClick={() => navigate('Review', { recordingId: r.id })}
                  style={{ padding: 10, borderRadius: 14, background: '#FFFFFF', border: '1px solid #E8E8EB', color: '#111114', font: 'inherit', textAlign: 'left', display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }}>
                  <Thumb blob={r.thumbnail} length={r.duration} />
                  <span style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{r.title}</span>
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#6E7079' }}>
                      {style && <span style={{ padding: '1px 6px', borderRadius: 999, background: CHIP_COLORS[style].bg, color: CHIP_COLORS[style].fg, fontWeight: 600 }}>{CHIP_LABEL[style]}</span>}
                      {whenLabel(r.createdAt, now)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {space && (
        <button type="button" onClick={() => navigate('Storage')} style={{ margin: '12px 16px 16px', padding: '12px 14px', borderRadius: 14, background: '#FFFFFF', border: '1px solid #E8E8EB', color: '#111114', font: 'inherit', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ fontWeight: 600 }}>{formatBytes(space.usage)} used by Klipkord</span><span style={{ fontWeight: 500, color: '#C2410C' }}>Free up space</span></span>
          <span role="progressbar" aria-label="Storage used" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 999, background: '#F1F1F3', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: '#111114' }} />
          </span>
          <span style={{ fontSize: 12, color: isDiskLow(free) ? '#B91C1C' : '#6E7079' }}>{formatBytes(free)} free on this computer</span>
        </button>
      )}
    </main>
  );
}
