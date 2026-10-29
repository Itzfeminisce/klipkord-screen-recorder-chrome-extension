import { useEffect, useRef, useState } from 'react';
import { useRouter } from '../router';
import { getRecording, updateRecording } from '@/lib/db';
import { useRecorder } from '@/lib/capture';
import { shortClock } from '@/lib/recorder';
import { formatBytes, formatClock } from '@/lib/time';
import type { Recording } from '@/lib/types';
import { DETECTED_BLURB, DETECTED_TITLE } from '@/lib/notes/style';
import { Brand, ICONS, Icon, StateCard } from './Home';
import { T_ICONS, useTranscript } from './Recording';
import { NoSpeechFound, NotesUnavailable, WritingBar, noSpeech, useNotesJob } from '../components/NotesBody';

/** The transcript row's title: shown as writing until the transcript is done. */
export const transcriptTitle = (pending: boolean) => (pending ? 'Writing the transcript' : 'Transcript ready');
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const DONE_DOT = { width: 24, height: 24, borderRadius: '50%', background: '#ECFDF3', color: '#15803D', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as const;
const SPIN_DOT = { width: 24, height: 24, borderRadius: '50%', border: '3px solid #F1F1F3', borderTopColor: '#C2410C', boxSizing: 'border-box', flexShrink: 0 } as const;

export default function Processing() {
  const { route, navigate } = useRouter();
  const id = route.params.recordingId;
  const recorder = useRecorder();
  const [rec, setRec] = useState<Recording | null>(null);
  const [title, setTitle] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typed = useRef(false);
  const progress = useNotesJob(id);
  const cloudDown = Boolean(useTranscript(id)?.cloudDown);
  const [now, setNow] = useState(() => Date.now());
  const phase = progress?.phase;
  const suggested = progress?.suggestedTitle;

  // The transcript and notes come from the same record; re-read while they are being written.
  useEffect(() => {
    if (!id || phase === 'done') return;
    const t = setInterval(() => {
      getRecording(id).then((r) => r && setRec(r), () => undefined);
      setNow(Date.now());
    }, 1_500);
    return () => clearInterval(t);
  }, [id, phase]);

  // A suggested title fills the box unless the person has started typing.
  useEffect(() => {
    if (suggested && !typed.current) setTitle(suggested);
  }, [suggested]);

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
    typed.current = true;
    setTitle(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!id) return;
      void updateRecording(id, (r) => ({ title: next.trim() || r.title }))
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

      {cloudDown && (
        <div style={{ margin: '16px 24px 0' }}>
          <StateCard icon={T_ICONS.cloud} tone="amber" title="Groq isn’t responding"
            body="Klipkord switched to on-device AI for this recording, so your transcript keeps going."
            action="Open Settings" onAction={() => navigate('Settings')} />
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
        {suggested && title === suggested && <span style={{ fontSize: 12, color: '#6E7079' }}>Suggested from what you said. Change it any time.</span>}
      </label>

      <ol style={{ listStyle: 'none', margin: '18px 24px 0', padding: 16, borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <li style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#ECFDF3', color: '#15803D', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={14}>{ICONS.check}</Icon></span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Video saved</span>
            {rec && <span style={{ fontSize: 12, color: '#6E7079' }}>{shortClock(rec.duration)} · {rec.height ? `${rec.height}p` : rec.quality} · {formatBytes(rec.bytes)}</span>}
          </span>
        </li>
        {rec && !noSpeech(rec) && (
          <li style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {rec.transcriptPending ? <span style={SPIN_DOT} aria-hidden="true" /> : <span style={DONE_DOT}><Icon size={14}>{ICONS.check}</Icon></span>}
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{transcriptTitle(rec.transcriptPending)}</span>
              {rec.transcriptPending && <span style={{ fontSize: 12, color: '#6E7079' }}>Turning what you said into text.</span>}
              {!rec.transcriptPending && (
                <span style={{ fontSize: 12, color: '#6E7079' }}>
                  {plural(rec.transcript.reduce((n, seg) => n + (seg.text.trim() ? seg.text.trim().split(/\s+/).length : 0), 0), 'word')} · {plural(rec.markers.length, 'marker')} · {plural(rec.notes.length, 'note')}
                </span>
              )}
            </span>
          </li>
        )}
        {progress?.style && (
          <li style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={DONE_DOT}><Icon size={14}>{ICONS.check}</Icon></span>
            <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{DETECTED_TITLE[progress.style]}</span>
              <span style={{ fontSize: 12, color: '#6E7079' }}>{DETECTED_BLURB[progress.style]}</span>
            </span>
            <button type="button" onClick={() => id && navigate('NoteStyle', { recordingId: id })}
              style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 13, fontWeight: 500, color: '#C2410C', cursor: 'pointer' }}>Change</button>
          </li>
        )}
        {progress && (phase === 'writing' || phase === 'done') && (
          <li style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {phase === 'done' ? <span style={DONE_DOT}><Icon size={14}>{ICONS.check}</Icon></span> : <span style={SPIN_DOT} aria-hidden="true" />}
            <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Writing notes and chapters</span>
              {phase === 'writing' && <WritingBar progress={progress} now={now} />}
            </span>
          </li>
        )}
      </ol>

      {noSpeech(rec) && <div style={{ margin: '12px 24px 0' }}><NoSpeechFound /></div>}
      {!noSpeech(rec) && (phase === 'no-engine' || phase === 'failed') && (
        <div style={{ margin: '12px 24px 0' }}>
          <NotesUnavailable groqDown={phase === 'failed' && progress?.engines?.length === 1 && progress.engines[0] === 'groq'} failed={phase === 'failed'} recordingId={id} />
        </div>
      )}

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
