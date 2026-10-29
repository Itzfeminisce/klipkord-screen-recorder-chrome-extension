import { useEffect, useState } from 'react';
import { getFolderHandle, getRecording } from '@/lib/db';
import { readSizes } from '@/lib/folder';
import { formatBytes } from '@/lib/time';
import type { Recording } from '@/lib/types';
import { Spinner } from '../components';
import { useRouter } from '../router';
import { BackBar } from './Export';

const MONO = "var(--mono, 'Geist Mono', monospace)";

export default function Saved() {
  const { route, replace } = useRouter();
  const id = route.params.recordingId;
  const [rec, setRec] = useState<Recording | null | undefined>();
  const [sizes, setSizes] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!id) return setRec(null);
    getRecording(id).then(async (r) => {
      setRec(r ?? null);
      const files = r?.savedTo?.files ?? [];
      const handle = await getFolderHandle();
      if (handle && files.length) setSizes(await readSizes(handle, files));
    }).catch((error) => { console.error('Klipkord: could not load the saved files', error); setRec((r) => r ?? null); });
  }, [id]);

  if (rec === undefined) return <main className="screen screen-center"><Spinner /></main>;
  const saved = rec?.savedTo;
  const sub = saved?.files[0]?.split('/')[0];
  const goReview = () => replace('Review', { recordingId: id });

  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      <BackBar label="Back" onBack={goReview} />
      <div style={{ padding: '48px 24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
        <span style={{ width: 72, height: 72, borderRadius: '50%', background: '#ECFDF3', color: '#15803D', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
        </span>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>Saved to your folder</h1>
        {saved && <p style={{ margin: 0, maxWidth: 300, fontSize: 14, lineHeight: 1.5, color: '#5F6168' }}>Find it in {saved.folder}{sub ? ` › ${sub}` : ''}.</p>}
      </div>

      {saved && (
        <div style={{ margin: '28px 24px 0', padding: '4px 14px', borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column' }}>
          {saved.files.map((path, i) => (
            <div key={path} style={{ borderTop: i ? '1px solid #EFEFF1' : undefined, padding: '12px 0', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontFamily: MONO, fontSize: 13, wordBreak: 'break-all' }}>{path.split('/').pop()}</span>
              <span style={{ color: '#6E7079', fontSize: 13, flexShrink: 0 }}>{sizes[path] !== undefined ? formatBytes(sizes[path]!) : ''}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ margin: '12px 24px 0', padding: '12px 14px', borderRadius: 12, background: '#FFFFFF', border: '1px solid #E8E8EB', fontSize: 13, lineHeight: 1.45, color: '#44464D' }}>
        To share it, send the video file or drop it into any chat or drive you already use.
      </div>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={() => replace('Home')} style={{ height: 48, border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>New recording</button>
        <button type="button" onClick={goReview} style={{ height: 44, border: 'none', borderRadius: 12, background: 'transparent', color: '#44464D', font: 'inherit', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Back to this recording</button>
      </div>
    </main>
  );
}
