import { useEffect, useRef, useState } from 'react';
import { useRouter } from '../router';
import { getRecording, putRecording } from '@/lib/db';
import { useRecorder } from '@/lib/capture';
import { shortClock } from '@/lib/recorder';
import { formatBytes, formatClock } from '@/lib/time';
import type { Recording } from '@/lib/types';
import { Brand, ICONS, Icon, StateCard } from './Home';

export default function Processing() {
  const { route, navigate } = useRouter();
  const id = route.params.recordingId;
  const recorder = useRecorder();
  const [rec, setRec] = useState<Recording | null>(null);
  const [title, setTitle] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    getRecording(id).then(
      (r) => {
        if (!r) return;
        setRec(r);
        setTitle(r.title);
      },
      (error) => console.error('Klipkord: could not load the recording', error),
    );
  }, [id]);

  // Saves the title shortly after typing stops; re-reads so other writers' fields are kept.
  function changeTitle(next: string) {
    setTitle(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!id) return;
      void getRecording(id)
        .then((r) => r && putRecording({ ...r, title: next.trim() || r.title }))
        .catch((error) => console.error('Klipkord: could not save the title', error));
    }, 400);
  }

  const sharingStopped = recorder?.endedBy === 'sharing-stopped' && recorder.recordingId === id;
  const watch = () => id && navigate('Review', { recordingId: id });

  return (
    <main className="screen" style={{ minHeight: '100vh', background: '#F6F6F7', color: '#111114' }}>
      <Brand />

      {sharingStopped && rec && (
        <div style={{ margin: '16px 24px 0' }}>
          <StateCard icon={ICONS.stop} tone="grey" title="You stopped sharing, so recording ended"
            body={`Everything up to ${formatClock(rec.duration)} is saved, and Klipkord is writing the notes.`}
            action="Watch it now" onAction={watch} />
        </div>
      )}

      <div style={{ padding: '20px 24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>Nice one. Finishing up.</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#5F6168' }}>Your video is safe. Klipkord is writing the notes on this computer.</p>
      </div>

      <label style={{ margin: '20px 24px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Title</span>
        <input type="text" value={title} onChange={(e) => changeTitle(e.target.value)} disabled={!rec}
          style={{ height: 44, padding: '0 12px', borderRadius: 10, border: '1px solid #DCDCE0', background: '#FFFFFF', font: 'inherit', fontSize: 14, color: '#111114', boxSizing: 'border-box' }} />
        {/* T7 slot: "Suggested from what you said. Change it any time." once the title is suggested. */}
      </label>

      <ol style={{ listStyle: 'none', margin: '18px 24px 0', padding: 16, borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <li style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#ECFDF3', color: '#15803D', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={14}>{ICONS.check}</Icon></span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Video saved</span>
            {rec && <span style={{ fontSize: 12, color: '#6E7079' }}>{shortClock(rec.duration)} · {rec.quality} · {formatBytes(rec.bytes)}</span>}
          </span>
        </li>
        {/* T6 slot: "Transcript ready". T7 slots: detected style with "Change", "Writing notes and chapters" progress. */}
      </ol>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={watch} disabled={!id}
          style={{ height: 48, border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          Watch it now
        </button>
        <span style={{ textAlign: 'center', fontSize: 12, color: '#6E7079' }}>Notes appear as soon as they’re ready.</span>
      </div>
    </main>
  );
}
