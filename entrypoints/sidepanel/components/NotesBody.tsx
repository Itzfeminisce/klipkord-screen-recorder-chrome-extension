import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { getRecording } from '@/lib/db';
import { decodeTimed } from '@/lib/notes/chapters';
import { STYLE_SECTIONS } from '@/lib/notes/style';
import { etaText, getProgress, startNotes, subscribeNotes, type NotesProgress } from '@/lib/notes/summarize';
import { formatClock } from '@/lib/time';
import type { NoteStyle, Notes, Recording } from '@/lib/types';
import { ICONS, StateCard } from '../screens/Home';
import { useRouter } from '../router';

const MONO = "var(--mono, 'Geist Mono', monospace)";

/** Progress of the notes job for a recording, and starts the job if the notes are not written yet. */
export function useNotesJob(recordingId: string | undefined): NotesProgress | undefined {
  const [progress, setProgress] = useState<NotesProgress | undefined>(() => (recordingId ? getProgress(recordingId) : undefined));
  useEffect(() => {
    if (!recordingId) return;
    setProgress(getProgress(recordingId));
    const stop = subscribeNotes(recordingId, () => setProgress(getProgress(recordingId)));
    void startNotes(recordingId);
    return stop;
  }, [recordingId]);
  return progress;
}

/** The thin bar under "Writing notes and chapters". */
export function WritingBar({ progress, now }: { progress: NotesProgress; now: number }) {
  const eta = etaText(progress, now);
  return (
    <>
      <span role="progressbar" aria-label="Writing notes" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100}
        style={{ height: 6, borderRadius: 999, background: '#F1F1F3', overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${progress.pct}%`, height: '100%', background: '#C2410C' }} />
      </span>
      {eta && <span style={{ fontSize: 12, color: '#6E7079' }}>{eta}</span>}
    </>
  );
}

/** When no AI can write the notes, or every one that could failed. */
export function NotesUnavailable({ groqDown }: { groqDown: boolean }) {
  const { navigate } = useRouter();
  return groqDown ? (
    <StateCard icon={ICONS.warn} tone="amber" title="Groq isn’t responding" body="Transcripts still run on this computer. For notes, use Ollama or Groq."
      action="Choose how to write notes" onAction={() => navigate('Settings')} />
  ) : (
    <StateCard icon={ICONS.warn} tone="grey" title="Chrome’s built-in AI isn’t available here" body="Transcripts still run on this computer. For notes, use Ollama or Groq."
      action="Choose how to write notes" onAction={() => navigate('Settings')} />
  );
}

const FOOTER: Record<string, string> = {
  builtin: 'Written on this computer by Chrome’s built-in AI.',
  ollama: 'Written on this computer by Ollama.',
  groq: 'Written by Groq.',
};

const H2: CSSProperties = { margin: 0, fontSize: 12, fontWeight: 600, color: '#5F6168', textTransform: 'uppercase', letterSpacing: '0.04em' };
const LIST: CSSProperties = { margin: 0, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, lineHeight: 1.45 };
const LINK: CSSProperties = { border: 'none', background: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: '#C2410C' };

function Time({ at, onSeek }: { at: number; onSeek?: (ms: number) => void }) {
  return <button type="button" onClick={() => onSeek?.(at)} style={{ ...LINK, fontFamily: MONO, fontSize: 12 }}>{formatClock(at)}</button>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><h2 style={H2}>{title}</h2>{children}</div>;
}

const bullets = (items: string[]) => (
  <ul style={{ ...LIST, paddingLeft: 20 }}>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
);

const SHOWS_POINTS: NoteStyle[] = ['update', 'meeting', 'general'];
const SHOWS_ACTIONS: NoteStyle[] = ['meeting', 'general'];

/** The notes for a style: summary, its sections, chapters. Times jump the player through `onSeek`. */
export function NotesView({ notes, onSeek }: { notes: Notes; onSeek?: (ms: number) => void }) {
  const sections = notes.sections ?? {};
  const defs = STYLE_SECTIONS[notes.style];
  const pair = notes.style === 'bug' && (sections.expected || sections.happened);
  return (
    <>
      {notes.summary && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>{notes.summary}</p>}
      {defs.filter((d) => !(pair && (d.key === 'expected' || d.key === 'happened'))).map((d) => {
        const lines = sections[d.key];
        if (!lines?.length) return null;
        return (
          <Section key={d.key} title={d.heading}>
            {d.timed ? (
              <ol style={{ ...LIST, paddingLeft: 20 }}>
                {lines.map((line, i) => {
                  const { at, text } = decodeTimed(line);
                  return <li key={i}>{text}{at !== undefined && <> <Time at={at} onSeek={onSeek} /></>}</li>;
                })}
              </ol>
            ) : bullets(lines)}
          </Section>
        );
      })}
      {pair && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {defs.filter((d) => d.key === 'expected' || d.key === 'happened').map((d) => (
            <div key={d.key} style={{ padding: 12, borderRadius: 12, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#5F6168' }}>{d.heading}</span>
              <span style={{ fontSize: 13, lineHeight: 1.45 }}>{(sections[d.key] ?? []).join(' ')}</span>
            </div>
          ))}
        </div>
      )}
      {SHOWS_POINTS.includes(notes.style) && notes.points.length > 0 && <Section title="Key points">{bullets(notes.points)}</Section>}
      {SHOWS_ACTIONS.includes(notes.style) && notes.actions.length > 0 && <Section title="Action items">{bullets(notes.actions)}</Section>}
      {notes.chapters.length > 0 && (
        <Section title="Chapters">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14 }}>
            {notes.chapters.map((c, i) => (
              <button key={i} type="button" onClick={() => onSeek?.(c.at)}
                style={{ padding: '6px 0', border: 'none', background: 'none', font: 'inherit', color: '#111114', textAlign: 'left', cursor: 'pointer', display: 'flex', gap: 12 }}>
                <span style={{ fontFamily: MONO, fontSize: 12, color: '#C2410C', width: 40 }}>{formatClock(c.at)}</span>{c.title}
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

/** Review's Notes tab body. While the notes are being written it shows progress, then fills in. */
export default function NotesBody({ recordingId, onSeek }: { recordingId: string | undefined; onSeek?: (ms: number) => void }) {
  const progress = useNotesJob(recordingId);
  const [rec, setRec] = useState<Recording | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const phase = progress?.phase;

  useEffect(() => {
    if (!recordingId) return;
    getRecording(recordingId).then((r) => setRec(r ?? null), (error) => console.error('Klipkord: could not load the notes', error));
  }, [recordingId, phase, progress?.style]);
  useEffect(() => {
    if (phase !== 'writing') return;
    const t = setInterval(() => setNow(Date.now()), 2_000);
    return () => clearInterval(t);
  }, [phase]);

  const body: CSSProperties = { flexGrow: 1, minHeight: 0, overflow: 'auto', padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 16 };
  const working = phase === 'waiting' || phase === 'style' || phase === 'writing';
  const notes = rec?.summary;

  return (
    <div style={body}>
      {working && progress && (
        <div style={{ padding: 14, borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', gap: 12 }}>
          <span style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #F1F1F3', borderTopColor: '#C2410C', boxSizing: 'border-box', flexShrink: 0 }} aria-hidden="true" />
          <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Writing notes and chapters</span>
            <WritingBar progress={progress} now={now} />
          </span>
        </div>
      )}
      {!working && (phase === 'no-engine' || phase === 'failed') && !notes && <NotesUnavailable groqDown={phase === 'failed' && progress?.engines?.length === 1 && progress.engines[0] === 'groq'} />}
      {!working && notes && <NotesView notes={notes} onSeek={onSeek} />}
      {!working && notes && FOOTER[notes.engine] && (
        <div style={{ padding: '10px 0 16px', fontSize: 12, color: '#6E7079' }}>{FOOTER[notes.engine]}</div>
      )}
    </div>
  );
}
