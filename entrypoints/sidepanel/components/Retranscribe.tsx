import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getRecording, updateRecording } from '@/lib/db';
import type { Recording } from '@/lib/types';
import { retranscribe, retranscribedPatch } from '@/lib/transcribe/full';
import { GROQ_CHUNK_MS, GroqError, loadTranscriptConfig, transcribeGroq } from '@/lib/transcribe/groq';
import { hasWords } from '@/lib/transcribe/merge';
import { readVoice } from '@/lib/transcribe/voice';
import { BASE_MODEL, Whisper } from '@/lib/transcribe/whisper';

export type RetranscribeReason = 'cuts' | 'live';

/** Which prompt a recording needs on EditTranscript, if any. A missing transcriptModel counts as live. */
export function retranscribeReason(rec: Recording): RetranscribeReason | null {
  if ((rec.transcriptModel ?? 'live') === 'live') return 'live';
  if (rec.edits.length && !hasWords(rec.transcript)) return 'cuts';
  return null;
}

const card: CSSProperties = { padding: 14, borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', gap: 10 };
const iconDot = (bg: string, fg: string): CSSProperties => ({
  width: 32, height: 32, borderRadius: '50%', background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
});
const btn: CSSProperties = { height: 44, padding: '0 16px', borderRadius: 10, font: 'inherit', fontSize: 13 };
const primary: CSSProperties = { ...btn, border: 'none', background: '#111114', color: '#FFFFFF', fontWeight: 600 };
const secondary: CSSProperties = { ...btn, border: '1px solid #E8E8EB', background: '#FFFFFF', color: '#111114', fontWeight: 500 };

const RedoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" /></svg>
);
const ClockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);

function Message({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {icon}
      <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>{body}</span>
      </span>
    </div>
  );
}

interface Job { stop: () => void; stopped: boolean }

/** Runs where Settings say: Groq with a key in cloud mode, else whisper-base here. Groq failing falls back to this computer. */
async function run(rec: Recording, job: Job, onPct: (pct: number) => void) {
  const cfg = await loadTranscriptConfig();
  const onProgress = (done: number, total: number) => onPct(total ? Math.floor((done / total) * 100) : 0);
  const stopped = () => job.stopped;
  if (cfg.ai === 'cloud' && cfg.groqKey) {
    const abort = new AbortController();
    job.stop = () => abort.abort();
    try {
      return await retranscribe(rec, {
        readVoice, stopped, onProgress, chunkMs: GROQ_CHUNK_MS,
        transcribe: (audio) => transcribeGroq(audio, { key: cfg.groqKey ?? '', language: cfg.language, signal: abort.signal }),
      });
    } catch (error) {
      if (job.stopped || !(error instanceof GroqError)) throw error;
      console.error('Klipkord: could not re-transcribe with Groq', error);
    }
  }
  const whisper = new Whisper(() => new Worker(new URL('../../offscreen/whisper.worker.ts', import.meta.url), { type: 'module' }));
  job.stop = () => whisper.terminate();
  try {
    await whisper.load(BASE_MODEL);
    return await retranscribe(rec, {
      readVoice, stopped, onProgress,
      transcribe: (audio) => whisper.transcribe(audio, cfg.language, true),
    });
  } finally {
    whisper.terminate();
  }
}

export interface RetranscribeProps {
  recording: Recording;
  reason: RetranscribeReason;
  /** The recording after its transcript was replaced. */
  onDone: (rec: Recording) => void;
  /** "Not now" or "Edit anyway". */
  onDismiss: () => void;
}

/** The retranscribe-prompt, retranscribe-prompt-live and retranscribing states of EditTranscript. */
export function Retranscribe({ recording, reason, onDone, onDismiss }: RetranscribeProps) {
  const [pct, setPct] = useState<number | null>(null);
  const job = useRef<Job | null>(null);

  // Leaving the screen stops the run; the transcript stays as it was.
  useEffect(() => () => {
    if (job.current) {
      job.current.stopped = true;
      job.current.stop();
    }
  }, []);

  async function start() {
    const j: Job = { stop: () => undefined, stopped: false };
    job.current = j;
    setPct(0);
    try {
      const segs = await run(recording, j, (p) => !j.stopped && setPct(p));
      if (j.stopped || !segs) return;
      // A run that heard nothing keeps the transcript there was.
      if (segs.some((s) => s.text)) await updateRecording(recording.id, retranscribedPatch(segs));
      onDone((await getRecording(recording.id)) ?? recording);
    } catch (error) {
      if (!j.stopped) console.error('Klipkord: could not re-transcribe the recording', error);
    } finally {
      if (job.current === j) {
        job.current = null;
        setPct(null);
      }
    }
  }

  function stop() {
    const j = job.current;
    if (!j) return;
    j.stopped = true;
    j.stop();
    job.current = null;
    setPct(null);
  }

  if (pct !== null) {
    return (
      <div style={card}>
        <Message icon={<span style={iconDot('#F1F1F3', '#44464D')}><ClockIcon /></span>} title="Re-transcribing"
          body="You can leave this open. Your cuts stay as they are and the video is not changed." />
        <div role="progressbar" aria-label="Re-transcribing" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ height: 6, borderRadius: 999, background: '#E8E8EB', position: 'relative', overflow: 'hidden' }}>
            <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 999, background: '#C2410C' }} />
          </span>
          <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#5F6168' }}>
            <span>Working on the edited video</span>
            <span style={{ fontFamily: "'Geist Mono', monospace" }}>{pct}%</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={secondary} onClick={stop}>Stop</button>
        </div>
      </div>
    );
  }

  const live = reason === 'live';
  return (
    <div style={card}>
      {live ? (
        <Message icon={<span style={iconDot('#F1F1F3', '#44464D')}><RedoIcon /></span>} title="This transcript came from the fast live model"
          body="It was written while you recorded, so it can miss words. Re-transcribe for a more accurate one before you edit." />
      ) : (
        <Message icon={<span style={iconDot('#FFF7E6', '#92400E')}><RedoIcon /></span>} title="Your cuts moved the words"
          body="The transcript still follows the original video, so some times are off. Re-transcribe the edited video to make them match. It runs where you set it in Settings." />
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={primary} onClick={() => void start()}>Re-transcribe</button>
        <button type="button" style={secondary} onClick={onDismiss}>{live ? 'Edit anyway' : 'Not now'}</button>
      </div>
    </div>
  );
}
