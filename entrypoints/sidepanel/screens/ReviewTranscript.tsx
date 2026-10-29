import { useEffect, useRef } from 'react';
import { currentLine, transcriptItems, transcriptText } from '@/lib/comments';
import { MARKER_LABEL } from '@/lib/markers';
import { formatClock } from '@/lib/time';
import { ReviewShell } from '../components/Player';

const MONO = "var(--mono, 'Geist Mono', monospace)";

export default function ReviewTranscript() {
  return (
    <ReviewShell tab="ReviewTranscript">
      {({ rec, now, seek }) => <Transcript rec={rec} now={now} seek={seek} />}
    </ReviewShell>
  );
}

function Transcript({ rec, now, seek }: { rec: import('@/lib/types').Recording; now: number; seek: (ms: number) => void }) {
  const current = currentLine(rec.transcript, now);
  const items = transcriptItems(rec.transcript, rec.markers, rec.notes);
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => { active.current?.scrollIntoView?.({ block: 'nearest' }); }, [current]);

  function copyAll() {
    navigator.clipboard.writeText(transcriptText(rec.transcript, formatClock)).catch((error) => console.error('Klipkord: could not copy the transcript', error));
  }

  return (
    <>
      <div style={{ padding: '10px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: '#6E7079' }}>Click a line to jump there.</span>
        <button type="button" onClick={copyAll}
          style={{ height: 32, padding: '0 10px', border: '1px solid #E8E8EB', borderRadius: 8, background: '#FFFFFF', font: 'inherit', fontSize: 12, fontWeight: 500, color: '#111114', cursor: 'pointer' }}>Copy all</button>
      </div>
      <div style={{ flexGrow: 1, minHeight: 0, overflow: 'auto', padding: '8px 8px 16px', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14, lineHeight: 1.5 }}>
        {items.map((item) => {
          if (item.kind === 'line') {
            const on = item.index === current;
            return (
              <button key={`l${item.index}`} ref={on ? active : undefined} type="button" aria-current={on ? 'true' : undefined} onClick={() => seek(item.segment.start)}
                style={{ padding: 8, border: 'none', borderRadius: 10, background: on ? '#FFF1EA' : 'none', color: '#111114', font: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', gap: 12 }}>
                <span style={{ fontFamily: MONO, fontSize: 12, color: on ? '#9A3412' : '#6E7079', paddingTop: 2, flexShrink: 0 }}>{formatClock(item.segment.start)}</span>
                <span>{item.segment.text}</span>
              </button>
            );
          }
          if (item.kind === 'marker') {
            return (
              <button key={`m${item.marker.id}`} type="button" onClick={() => seek(item.at)}
                style={{ padding: '4px 8px 4px 60px', border: 'none', background: 'none', font: 'inherit', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ padding: '3px 8px', borderRadius: 999, background: '#FFF1EA', color: '#9A3412', fontSize: 12, fontWeight: 600 }}>{MARKER_LABEL[item.marker.kind]}</span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: '#6E7079' }}>{formatClock(item.at)}</span>
              </button>
            );
          }
          return (
            <button key={`n${item.note.id}`} type="button" onClick={() => seek(item.at)}
              style={{ margin: '2px 8px 2px 60px', padding: '8px 10px', borderRadius: 10, background: '#FFFFFF', border: '1px solid #E8E8EB', font: 'inherit', fontSize: 13, color: '#111114', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#6E7079' }}>Your note · {formatClock(item.at)}</span>
              {item.note.text}
            </button>
          );
        })}
      </div>
    </>
  );
}
