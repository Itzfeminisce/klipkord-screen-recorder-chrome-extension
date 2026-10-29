import { useEffect, useState } from 'react';
import { useRouter } from '../router';
import { deleteRecording, getRecording, updateRecording } from '@/lib/db';
import { videoStore } from '@/lib/videoStore';
import { shortClock } from '@/lib/recorder';
import { formatBytes } from '@/lib/time';
import type { Recording } from '@/lib/types';
import { Brand, ICONS, Icon, Thumb, dayAndTime } from './Home';

/** "yesterday at 16:42", "today at 09:10", "on 12 Oct at 16:42". */
function whenPhrase(at: number, now = Date.now()): string {
  const [day, time] = dayAndTime(at, now).split(', ');
  if (day === 'Today' || day === 'Yesterday') return `${day.toLowerCase()} at ${time}`;
  return `on ${day} at ${time}`;
}

export default function Recovered() {
  const { route, replace } = useRouter();
  const id = route.params.recordingId;
  const [rec, setRec] = useState<Recording | null>(null);
  const [bytes, setBytes] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return replace('Home');
    getRecording(id).then(
      (r) => (r ? setRec(r) : replace('Home')),
      (error) => console.error('Klipkord: could not load the recording', error),
    );
    videoStore.size(id).then(setBytes, (error) => console.error('Klipkord: could not measure the video', error));
  }, [id, replace]);

  async function keep() {
    if (!rec) return;
    setBusy(true);
    try {
      // A recovered take has no transcript still running, so notes must not wait on one.
      await updateRecording(rec.id, (r) => ({ status: 'processing', bytes: bytes || r.bytes, transcriptPending: false }));
      replace('Processing', { recordingId: rec.id });
    } catch (error) {
      console.error('Klipkord: could not keep the recording', error);
      setBusy(false);
    }
  }

  async function remove() {
    if (!rec) return;
    setBusy(true);
    try {
      await videoStore.remove(rec.id);
      await deleteRecording(rec.id);
    } catch (error) {
      console.error('Klipkord: could not delete the recording', error);
    }
    replace('Home');
  }

  const lastSegment = rec?.transcript[rec.transcript.length - 1];

  return (
    <main className="screen" style={{ minHeight: '100vh', background: '#F6F6F7', color: '#111114' }}>
      <Brand />
      <div style={{ padding: '40px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ width: 48, height: 48, borderRadius: 14, background: '#FFF7E6', color: '#92400E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={22}>{ICONS.recover}</Icon></span>
        <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>We saved your last recording</h1>
        {rec && (
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#5F6168' }}>
            Chrome closed while you were recording {whenPhrase(rec.createdAt + rec.duration)}. Klipkord kept everything up to the last second.
          </p>
        )}
      </div>

      {rec && (
        <div style={{ margin: '22px 24px 0', padding: 12, borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', gap: 12, alignItems: 'center' }}>
          <Thumb recording={rec} width={112} height={64} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{rec.title}</span>
            <span style={{ fontSize: 12, color: '#6E7079' }}>{dayAndTime(rec.createdAt)} · {shortClock(rec.duration)} · {formatBytes(bytes || rec.bytes)}</span>
            {lastSegment && <span style={{ fontSize: 12, color: '#6E7079' }}>Transcript up to {shortClock(lastSegment.end)}</span>}
          </span>
        </div>
      )}

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={() => void keep()} disabled={!rec || busy}
          style={{ height: 48, border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          Keep it and write the notes
        </button>
        <button type="button" onClick={() => void remove()} disabled={!rec || busy}
          style={{ height: 44, border: 'none', borderRadius: 12, background: 'transparent', color: '#B91C1C', font: 'inherit', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          Delete it
        </button>
        <span style={{ textAlign: 'center', fontSize: 12, color: '#6E7079' }}>Nothing is deleted unless you choose to.</span>
      </div>
    </main>
  );
}
