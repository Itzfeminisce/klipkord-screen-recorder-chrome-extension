import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { getRecording } from '@/lib/db';
import {
  PROBE_SEEK_SECONDS, chapterAt, formatLength, needsDurationProbe, percentOf, saveComments, sortComments, timeAtPoint,
} from '@/lib/comments';
import { playable } from '@/lib/editList';
import { MARKER_LABEL } from '@/lib/markers';
import { formatClock } from '@/lib/time';
import { videoStore } from '@/lib/videoStore';
import type { Comment, Recording } from '@/lib/types';
import { STYLE_NAMES, dayAndTime } from '../screens/Home';
import { useRouter, type ScreenName } from '../router';

export type ReviewTab = 'Review' | 'ReviewTranscript' | 'ReviewComments' | 'ReviewAsk';

export interface ReviewContext {
  rec: Recording;
  /** Playhead, ms into the recording. */
  now: number;
  seek: (ms: number) => void;
  setComments: (comments: Comment[]) => void;
}

const MONO = "var(--mono, 'Geist Mono', monospace)";
const PLAY = <svg width="18" height="18" viewBox="0 0 24 24" fill="#111114" aria-hidden="true"><path d="M8 5l12 7-12 7z" /></svg>;
const PAUSE = <svg width="18" height="18" viewBox="0 0 24 24" fill="#111114" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>;
const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

interface TimelineProps {
  label: string;
  rec: Recording;
  now: number;
  withComments: boolean;
  onSeek: (ms: number) => void;
}

/** Progress, chapter ticks, marker dots and (on Comments) comment pins. A click anywhere jumps there. */
function Timeline({ label, rec, now, withComments, onSeek }: TimelineProps) {
  const track = useRef<HTMLDivElement>(null);
  const duration = rec.duration;
  const chapters = rec.summary?.chapters ?? [];
  const pct = (ms: number) => `${percentOf(ms, duration)}%`;

  function click(x: number) {
    const box = track.current?.getBoundingClientRect();
    if (box) onSeek(timeAtPoint(x, box.left, box.width, duration));
  }
  function key(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 5000 : e.key === 'ArrowLeft' ? -5000 : 0;
    if (!step) return;
    e.preventDefault();
    onSeek(Math.min(duration, Math.max(0, now + step)));
  }

  return (
    <div onClick={(e) => click(e.clientX)} style={{ padding: '9px 0', cursor: 'pointer' }}>
      <div ref={track} role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(duration / 1000)}
        aria-valuenow={Math.round(now / 1000)} aria-valuetext={formatClock(now)} onKeyDown={key}
        style={{ position: 'relative', height: 6, borderRadius: 999, background: '#3A3A41' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, width: pct(now), height: '100%', borderRadius: 999, background: '#F6F6F7' }} />
        {chapters.map((c, i) => (
          <span key={`c${i}`} style={{ position: 'absolute', left: pct(c.at), top: -2, width: 2, height: 10, background: '#9A9BA3' }} />
        ))}
        {rec.markers.map((m) => (
          <button key={m.id} type="button" title={`${MARKER_LABEL[m.kind]} at ${formatClock(m.at)}`} aria-label={`${MARKER_LABEL[m.kind]} at ${formatClock(m.at)}`}
            onClick={(e) => { e.stopPropagation(); onSeek(m.at); }}
            style={{ position: 'absolute', left: pct(m.at), top: -4, width: 14, height: 14, padding: 0, borderRadius: '50%', background: '#C2410C', border: '2px solid #111114', boxSizing: 'border-box', cursor: 'pointer' }} />
        ))}
        {withComments && sortComments(rec.comments).map((c) => (
          <button key={c.id} type="button" title={`Comment at ${formatClock(c.at)}`} aria-label={`Comment at ${formatClock(c.at)}`}
            onClick={(e) => { e.stopPropagation(); onSeek(c.at); }}
            style={{ position: 'absolute', left: pct(c.at), top: -5, width: 16, height: 16, padding: 0, borderRadius: '50% 50% 50% 0', background: c.resolved ? '#6E7079' : '#FBBF24', border: '2px solid #111114', boxSizing: 'border-box', cursor: 'pointer' }} />
        ))}
      </div>
    </div>
  );
}

function tabStyle(on: boolean) {
  return {
    padding: '10px 0', border: 'none', borderBottom: on ? '2px solid #111114' : 'none', marginBottom: on ? -1 : 0, background: 'none', font: 'inherit',
    fontSize: 14, fontWeight: on ? 600 : 500, color: on ? '#111114' : '#5F6168', cursor: 'pointer',
  } as const;
}

/** The header, player and tabs shared by the three Review screens. */
export function ReviewShell({ tab, children }: { tab: ReviewTab; children: (ctx: ReviewContext) => ReactNode }) {
  const { route, navigate, replace } = useRouter();
  const id = route.params.recordingId;
  const [rec, setRec] = useState<Recording | null>(null);
  const [src, setSrc] = useState<string | undefined>();
  const [now, setNow] = useState(route.params.atMs ?? 0);
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const pending = useRef<number | null>(route.params.atMs ? route.params.atMs / 1000 : null);
  const probing = useRef(false);
  const edits = rec?.edits ?? [];
  const length = rec && rec.duration > 0 ? rec.duration : Infinity;

  useEffect(() => {
    if (!id) return;
    getRecording(id).then((r) => setRec(r ?? null), (error) => console.error('Klipkord: could not load the recording', error));
  }, [id]);

  // The object URL is revoked when the screen goes away.
  useEffect(() => {
    if (!id || !rec) return;
    let url: string | undefined;
    let gone = false;
    videoStore.read(id, 'video', rec.mime).then((blob) => {
      if (gone || blob.size === 0) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    }, (error) => console.error('Klipkord: could not open the video', error));
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [id, rec?.id, rec?.mime]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useCallback(() => {
    const v = video.current;
    if (!v || pending.current === null || probing.current) return;
    v.currentTime = pending.current;
    pending.current = null;
  }, []);

  const onMetadata = () => {
    const v = video.current;
    if (!v) return;
    if (needsDurationProbe(v.duration)) {
      // A seek far past the end makes the browser learn the real length; then seeking works.
      probing.current = true;
      v.currentTime = PROBE_SEEK_SECONDS;
    } else apply();
  };
  const settle = () => {
    const v = video.current;
    if (v && probing.current && Number.isFinite(v.duration) && v.duration > 0) {
      probing.current = false;
      v.currentTime = pending.current ?? 0;
      pending.current = null;
    }
  };
  const onTime = () => {
    const v = video.current;
    if (!v || probing.current) return;
    const ms = v.currentTime * 1000;
    const { at, ended } = playable(edits, length, ms);
    if (at !== ms) {
      // Inside a cut part: jump to the next kept part, or stop at the end.
      if (ended) v.pause();
      v.currentTime = at / 1000;
    }
    setNow(at);
  };

  const seek = useCallback((ms: number) => {
    const v = video.current;
    const mapped = Math.max(0, playable(edits, length, ms).at);
    setNow(mapped);
    if (!v) { pending.current = mapped / 1000; return; }
    if (probing.current || v.readyState === 0) { pending.current = mapped / 1000; return; }
    v.currentTime = Number.isFinite(v.duration) && v.duration > 0 ? Math.min(mapped / 1000, v.duration) : mapped / 1000;
  }, [edits, length]);

  function toggle() {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch((error) => console.error('Klipkord: could not play the video', error));
    else v.pause();
  }

  const setComments = useCallback((comments: Comment[]) => {
    if (!id) return;
    setRec((r) => (r ? { ...r, comments } : r));
    saveComments(id, comments).catch((error) => console.error('Klipkord: could not save the comment', error));
  }, [id]);

  const go = (screen: ScreenName) => navigate(screen, { recordingId: id, atMs: now });
  const tabTo = (screen: ScreenName) => { if (screen !== tab) replace(screen, { recordingId: id, atMs: now }); };

  if (!rec) return <main className="screen" style={{ height: '100vh' }} />;

  const chapter = chapterAt(rec.summary?.chapters ?? [], now);
  const style = rec.summary?.style;
  const timelineLabel = tab === 'ReviewComments' ? 'Timeline with comments' : 'Timeline';

  return (
    <main className="screen" style={{ height: '100vh', minHeight: 0, background: '#F6F6F7', color: '#111114' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 16px 0' }}>
        <button type="button" aria-label="Back to library" onClick={() => replace('Library')}
          style={{ width: 44, height: 44, border: 'none', borderRadius: 12, background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111114', cursor: 'pointer' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth="2" {...stroke}><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <span style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rec.title}</span>
          <span style={{ fontSize: 12, color: '#6E7079' }}>{dayAndTime(rec.createdAt)} · {formatLength(rec.duration)}</span>
        </span>
      </div>

      <div style={{ margin: '8px 16px 0', borderRadius: 14, background: '#111114', overflow: 'hidden' }}>
        <div style={{ height: 188, position: 'relative', background: '#26262B' }}>
          <video ref={video} src={src} playsInline preload="metadata" onLoadedMetadata={onMetadata} onDurationChange={settle} onSeeked={settle}
            onTimeUpdate={() => { settle(); onTime(); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
            onClick={toggle} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          {!playing && (
            <button type="button" aria-label="Play" onClick={toggle}
              style={{ position: 'absolute', left: '50%', top: '50%', width: 52, height: 52, margin: '-26px 0 0 -26px', padding: 0, border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>{PLAY}</button>
          )}
          {playing && (
            <button type="button" aria-label="Pause" onClick={toggle}
              style={{ position: 'absolute', right: 12, top: 12, width: 36, height: 36, padding: 0, border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>{PAUSE}</button>
          )}
        </div>
        <div style={{ padding: '1px 12px 12px', display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Timeline label={timelineLabel} rec={rec} now={now} withComments={tab === 'ReviewComments'} onSeek={seek} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: MONO, fontSize: 11, color: '#9A9BA3' }}>
            <span>{formatClock(now)}</span>
            {chapter && <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chapter.title}</span>}
            <span>{formatLength(rec.duration)}</span>
          </div>
        </div>
      </div>

      {tab === 'Review' && (
        <div style={{ margin: '12px 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          {style && (
            <button type="button" onClick={() => go('NoteStyle')}
              style={{ height: 36, padding: '0 12px', border: 'none', borderRadius: 999, background: '#FFF1EA', color: '#9A3412', font: 'inherit', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              {STYLE_NAMES[style]}
              <svg width="12" height="12" viewBox="0 0 24 24" strokeWidth="2.4" {...stroke}><path d="M6 9l6 6 6-6" /></svg>
            </button>
          )}
          <span style={{ flexGrow: 1 }} />
          <button type="button" onClick={() => go('Trim')}
            style={{ height: 36, padding: '0 12px', borderRadius: 10, background: '#FFFFFF', border: '1px solid #E8E8EB', color: '#111114', font: 'inherit', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth="2" {...stroke}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" /></svg>Trim
          </button>
          <button type="button" onClick={() => go('Export')}
            style={{ height: 36, padding: '0 14px', border: 'none', borderRadius: 10, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save</button>
        </div>
      )}

      <div role="tablist" aria-label="Recording views" style={{ margin: '14px 16px 0', display: 'flex', gap: 20, borderBottom: '1px solid #E8E8EB' }}>
        <button type="button" role="tab" aria-selected={tab === 'Review'} onClick={() => tabTo('Review')} style={tabStyle(tab === 'Review')}>Notes</button>
        <button type="button" role="tab" aria-selected={tab === 'ReviewTranscript'} onClick={() => tabTo('ReviewTranscript')} style={tabStyle(tab === 'ReviewTranscript')}>Transcript</button>
        <button type="button" role="tab" aria-selected={tab === 'ReviewComments'} onClick={() => tabTo('ReviewComments')} style={tabStyle(tab === 'ReviewComments')}>
          {rec.comments.length > 0 ? `Comments · ${rec.comments.length}` : 'Comments'}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'ReviewAsk'} onClick={() => tabTo('ReviewAsk')} style={tabStyle(tab === 'ReviewAsk')}>Ask</button>
      </div>

      {children({ rec, now, seek, setComments })}
    </main>
  );
}
