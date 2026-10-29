import { useEffect, useMemo, useState } from 'react';
import { listRecordings } from '@/lib/db';
import { splitDeletable, totalBytes } from '@/lib/library';
import { freeBytes, isDiskLow } from '@/lib/storageMath';
import { formatBytes } from '@/lib/time';
import type { Recording } from '@/lib/types';
import { videoStore } from '@/lib/videoStore';
import { Spinner } from '../components';
import { useRouter } from '../router';
import { BackBar } from './Export';

const CARD = { margin: '18px 24px 0', padding: 16, borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', gap: 12 } as const;
const plural = (n: number) => `${n} ${n === 1 ? 'video' : 'videos'}`;

interface Data { recs: Recording[]; sizes: Record<string, number>; usage: number; quota: number }

async function load(): Promise<Data> {
  const [all, { usage, quota }] = await Promise.all([listRecordings(), videoStore.usage()]);
  const recs = all.filter((r) => r.status === 'ready');
  const sizes: Record<string, number> = {};
  await Promise.all(recs.map(async (r) => { sizes[r.id] = await videoStore.size(r.id).catch(() => 0); }));
  return { recs, sizes, usage, quota };
}

export default function Storage() {
  const { back } = useRouter();
  const [data, setData] = useState<Data | undefined>();
  const [off, setOff] = useState<Set<string>>(new Set());   // unchecked ids; all start checked
  const [busy, setBusy] = useState(false);

  const refresh = () => load().then(setData, (error) => console.error('Klipkord: could not read storage use', error));
  useEffect(() => { void refresh(); }, []);

  const { saved, unsaved } = useMemo(() => (data ? splitDeletable(data.recs, data.sizes) : { saved: [], unsaved: [] }), [data]);
  if (!data) return <main className="screen screen-center"><Spinner /></main>;

  const picked = saved.filter((c) => !off.has(c.rec.id));
  const videos = Object.values(data.sizes).reduce((n, b) => n + b, 0);
  const notes = Math.max(0, data.usage - videos);
  const free = freeBytes(data);
  const total = Math.max(1, data.usage + free);
  const low = isDiskLow(free);

  async function remove() {
    setBusy(true);
    try {
      for (const { rec } of picked) {
        await videoStore.remove(rec.id); // only the OPFS video and voice; the record keeps notes, transcript and comments
      }
      setOff(new Set());
      await refresh();
    } catch (error) {
      console.error('Klipkord: could not delete the videos', error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      <BackBar label="Back to library" onBack={back} title="Free up space" />

      <div style={{ margin: '12px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.03em' }}>{formatBytes(data.usage)}</span>
          <span style={{ fontSize: 14, color: '#5F6168' }}>used by Klipkord</span>
        </span>
        <span style={{ height: 10, borderRadius: 999, background: '#EBEBEE', overflow: 'hidden', display: 'flex' }} role="img" aria-label="Storage used by videos and notes">
          <span style={{ width: `${(videos / total) * 100}%`, background: '#111114' }} />
          <span style={{ width: `${Math.max(notes > 0 ? 1 : 0, (notes / total) * 100)}%`, background: '#C2410C' }} />
        </span>
        <span style={{ display: 'flex', gap: 16, fontSize: 12, color: '#44464D', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#111114' }} />Videos {formatBytes(videos)}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#C2410C' }} />Notes {formatBytes(notes)}</span>
          <span style={{ color: low ? '#B91C1C' : undefined, fontWeight: low ? 600 : undefined }}>{formatBytes(free)} free</span>
        </span>
      </div>

      {saved.length > 0 && (
        <div style={CARD}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Delete videos you’ve already saved</span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>These are safe in your folder. Their notes, transcripts and comments stay in Klipkord.</span>
          </span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {saved.map(({ rec, bytes }, i) => (
              <label key={rec.id} style={{ padding: '10px 0', display: 'flex', alignItems: 'center', gap: 12, borderBottom: i < saved.length - 1 ? '1px solid #EFEFF1' : undefined }}>
                <input type="checkbox" checked={!off.has(rec.id)} onChange={(e) => setOff((s) => { const n = new Set(s); if (e.target.checked) n.delete(rec.id); else n.add(rec.id); return n; })}
                  style={{ width: 18, height: 18, accentColor: '#C2410C', margin: 0 }} />
                <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{rec.title}</span>
                  <span style={{ fontSize: 12, color: '#6E7079' }}>Saved to folder · {new Date(rec.savedTo!.at).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                </span>
                <span style={{ fontSize: 13, color: '#44464D' }}>{formatBytes(bytes)}</span>
              </label>
            ))}
          </div>
          <button type="button" disabled={busy || picked.length === 0} onClick={() => void remove()}
            style={{ height: 44, border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 14, fontWeight: 600, opacity: picked.length === 0 ? 0.5 : 1, cursor: 'pointer' }}>
            {busy ? <Spinner /> : `Delete ${plural(picked.length)} · ${formatBytes(totalBytes(picked))}`}
          </button>
        </div>
      )}

      {unsaved.length > 0 && (
        <div style={{ ...CARD, marginTop: 12, gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Not saved yet</span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>{plural(unsaved.length)} · {formatBytes(totalBytes(unsaved))}. Save them to your folder first, or delete them from the recording page.</span>
        </div>
      )}

      <div style={{ flexGrow: 1 }} />
      <p style={{ margin: '16px 24px 24px', fontSize: 12, lineHeight: 1.5, color: '#6E7079' }}>Klipkord warns you when less than 2 GB is free, so a recording never stops for lack of space.</p>
    </main>
  );
}
