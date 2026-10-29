import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { PROBE_SEEK_SECONDS, formatLength, needsDurationProbe, percentOf, timeAtPoint } from '@/lib/comments';
import { getRecording, updateRecording } from '@/lib/db';
import { cut, describe, editedLength, keptRanges, playable, restore, setEnd, setStart, type Edit } from '@/lib/editList';
import { formatClock } from '@/lib/time';
import type { KeptRange, Recording } from '@/lib/types';
import { videoStore } from '@/lib/videoStore';
import { useRouter } from '../router';

const MONO = "'Geist Mono', monospace";
const STEP_MS = 1000;
const DRAG_PX = 4;

interface Selection { from: number; to: number }

const plainButton = {
  height: 44, border: '1px solid #E8E8EB', borderRadius: 12, background: '#FFFFFF', font: 'inherit', fontSize: 13, fontWeight: 500, color: '#111114', cursor: 'pointer',
} as const;

function EditLine({ edit, onRestore }: { edit: Edit; onRestore: () => void }) {
  const time = { fontFamily: MONO, fontSize: 13 };
  return (
    <div style={{ padding: '10px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14 }}>
      {edit.kind === 'start' && <span>Starts at <span style={time}>{formatClock(edit.at)}</span></span>}
      {edit.kind === 'cut' && <span>Cut <span style={time}>{formatClock(edit.from)} – {formatClock(edit.to)}</span></span>}
      {edit.kind === 'end' && <span>Ends at <span style={time}>{formatClock(edit.at)}</span></span>}
      <button type="button" onClick={onRestore}
        style={{ height: 32, border: 'none', background: 'transparent', font: 'inherit', fontSize: 13, fontWeight: 500, color: '#C2410C', cursor: 'pointer' }}>Restore</button>
    </div>
  );
}

export default function Trim() {
  const { route, back, canGoBack, replace } = useRouter();
  const id = route.params.recordingId;
  const [rec, setRec] = useState<Recording | null>(null);
  const [edits, setEdits] = useState<KeptRange[]>([]);
  const [src, setSrc] = useState<string | undefined>();
  const [now, setNow] = useState(route.params.atMs ?? 0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const probing = useRef(false);
  const pending = useRef<number | null>(route.params.atMs ? route.params.atMs / 1000 : null);
  const drag = useRef<{ kind: 'start' | 'end' | 'select'; x: number; at: number } | null>(null);
  const duration = rec?.duration ?? 0;

  useEffect(() => {
    if (!id) return;
    getRecording(id).then((r) => { setRec(r ?? null); setEdits(r?.edits ?? []); }, (error) => console.error('Klipkord: could not load the recording', error));
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

  const seek = useCallback((ms: number) => {
    const at = Math.min(duration, Math.max(0, ms));
    setNow(at);
    const v = video.current;
    if (!v || probing.current || v.readyState === 0) { pending.current = at / 1000; return; }
    v.currentTime = Number.isFinite(v.duration) && v.duration > 0 ? Math.min(at / 1000, v.duration) : at / 1000;
  }, [duration]);

  const onMetadata = () => {
    const v = video.current;
    if (!v) return;
    if (needsDurationProbe(v.duration)) {
      // A seek far past the end makes the browser learn the real length; then seeking works.
      probing.current = true;
      v.currentTime = PROBE_SEEK_SECONDS;
    } else if (pending.current !== null) {
      v.currentTime = pending.current;
      pending.current = null;
    }
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
    if (v.paused) { setNow(ms); return; }
    // While playing, the preview skips the parts cut so far.
    const { at, ended } = playable(edits, duration > 0 ? duration : Infinity, ms);
    if (at !== ms) {
      if (ended) v.pause();
      v.currentTime = at / 1000;
    }
    setNow(at);
  };

  function toggle() {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch((error) => console.error('Klipkord: could not play the video', error));
    else v.pause();
  }

  const timeAt = (x: number) => {
    const box = track.current?.getBoundingClientRect();
    return box ? timeAtPoint(x, box.left, box.width, duration) : 0;
  };

  function down(e: PointerEvent<HTMLElement>, kind: 'start' | 'end' | 'select') {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { kind, x: e.clientX, at: timeAt(e.clientX) };
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const at = timeAt(e.clientX);
    if (d.kind === 'start') setEdits((list) => setStart(list, duration, at));
    else if (d.kind === 'end') setEdits((list) => setEnd(list, duration, at));
    else if (Math.abs(e.clientX - d.x) >= DRAG_PX) setSelection({ from: Math.min(d.at, at), to: Math.max(d.at, at) });
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'select' && Math.abs(e.clientX - d.x) < DRAG_PX) { setSelection(null); seek(d.at); }
    else if (d.kind !== 'select') seek(timeAt(e.clientX));
  }
  function key(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? STEP_MS : e.key === 'ArrowLeft' ? -STEP_MS : 0;
    if (!step) return;
    e.preventDefault();
    const next = Math.min(duration, Math.max(0, now + step));
    // Shift with an arrow grows a selection from the playhead.
    if (e.shiftKey) {
      const anchor = selection ? (selection.from === now ? selection.to : selection.from) : now;
      setSelection(next === anchor ? null : { from: Math.min(anchor, next), to: Math.max(anchor, next) });
    }
    seek(next);
  }
  function handleKey(e: KeyboardEvent, kind: 'start' | 'end', at: number) {
    const step = e.key === 'ArrowRight' ? STEP_MS : e.key === 'ArrowLeft' ? -STEP_MS : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    setEdits((list) => (kind === 'start' ? setStart(list, duration, at + step) : setEnd(list, duration, at + step)));
  }

  function cutSelection() {
    if (!selection) return;
    setEdits((list) => cut(list, duration, selection.from, selection.to));
    setSelection(null);
  }

  const leave = () => (canGoBack ? back() : replace('Review', { recordingId: id }));
  async function done() {
    if (!id || saving) return;
    setSaving(true);
    try {
      await updateRecording(id, { edits });
      leave();
    } catch (error) {
      console.error('Klipkord: could not save the edits', error);
      setSaving(false);
    }
  }

  if (!rec) return <main className="screen" style={{ height: '100vh' }} />;

  const kept = keptRanges(edits, duration);
  const first = kept[0];
  const last = kept[kept.length - 1];
  const startAt = first?.start ?? 0;
  const endAt = last?.end ?? duration;
  const list = describe(edits, duration);
  const pct = (ms: number) => percentOf(ms, duration);
  const handle = (kind: 'start' | 'end', at: number) => (
    <span role="slider" tabIndex={0} aria-label={kind === 'start' ? 'Starts at' : 'Ends at'} aria-valuemin={0} aria-valuemax={Math.round(duration / 1000)}
      aria-valuenow={Math.round(at / 1000)} aria-valuetext={formatClock(at)}
      onPointerDown={(e) => down(e, kind)} onKeyDown={(e) => handleKey(e, kind, at)}
      style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${pct(at)}% - ${kind === 'start' ? 0 : 6}px)`, width: 6, borderRadius: 3, background: '#C2410C', cursor: 'ew-resize', touchAction: 'none', zIndex: 2 }}>
      <span style={{ position: 'absolute', inset: '0 -8px' }} />
    </span>
  );

  return (
    <main className="screen" style={{ height: '100vh', minHeight: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: '#F6F6F7', color: '#111114' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px 0', gap: 8 }}>
        <button type="button" onClick={leave}
          style={{ height: 44, padding: '0 8px', border: 'none', borderRadius: 12, background: 'none', color: '#44464D', font: 'inherit', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
        <h1 style={{ flexGrow: 1, margin: 0, textAlign: 'center', fontSize: 16, fontWeight: 600 }}>Trim</h1>
        <button type="button" onClick={done} disabled={saving}
          style={{ height: 36, padding: '0 14px', border: 'none', borderRadius: 10, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Done</button>
      </div>

      <div style={{ margin: '12px 16px 0', height: 200, borderRadius: 14, background: '#26262B', position: 'relative', overflow: 'hidden' }}>
        <video ref={video} src={src} playsInline preload="auto" onLoadedMetadata={onMetadata} onDurationChange={settle} onSeeked={settle}
          onTimeUpdate={() => { settle(); onTime(); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
          onClick={toggle} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        {!playing && (
          <button type="button" aria-label="Play" onClick={toggle}
            style={{ position: 'absolute', left: '50%', top: '50%', width: 52, height: 52, margin: '-26px 0 0 -26px', padding: 0, border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#111114" aria-hidden="true"><path d="M8 5l12 7-12 7z" /></svg>
          </button>
        )}
        {playing && (
          <button type="button" aria-label="Pause" onClick={toggle}
            style={{ position: 'absolute', right: 12, top: 12, width: 36, height: 36, padding: 0, border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#111114" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
          </button>
        )}
        <span style={{ position: 'absolute', left: 12, bottom: 12, padding: '4px 8px', borderRadius: 6, background: 'rgba(17,17,20,0.8)', color: '#FFFFFF', fontFamily: MONO, fontSize: 12 }}>{formatClock(now)}</span>
      </div>

      <div style={{ margin: '18px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div ref={track} role="slider" tabIndex={0} aria-label="Trim timeline" aria-valuemin={0} aria-valuemax={Math.round(duration / 1000)}
          aria-valuenow={Math.round(now / 1000)} aria-valuetext={formatClock(now)} onKeyDown={key}
          onPointerDown={(e) => down(e, 'select')} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}
          style={{ position: 'relative', height: 56, borderRadius: 10, background: '#3A3A41', overflow: 'hidden', display: 'flex', cursor: 'pointer', touchAction: 'none', userSelect: 'none' }}>
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} style={{ flex: 1, background: i % 2 ? '#55555D' : '#4A4A52', borderRight: i < 7 ? '1px solid #3A3A41' : 'none' }} />
          ))}
          {startAt > 0 && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct(startAt)}%`, background: 'rgba(246,246,247,0.82)' }} />}
          {kept.slice(1).map((r, i) => (
            <span key={r.start} style={{ position: 'absolute', left: `${pct(kept[i]!.end)}%`, top: 0, bottom: 0, width: `${pct(r.start) - pct(kept[i]!.end)}%`, background: 'repeating-linear-gradient(135deg, rgba(246,246,247,0.85) 0 6px, rgba(220,220,224,0.85) 6px 12px)' }} />
          ))}
          {endAt < duration && <span style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${100 - pct(endAt)}%`, background: 'rgba(246,246,247,0.82)' }} />}
          {selection && (
            <span style={{ position: 'absolute', left: `${pct(selection.from)}%`, top: 0, bottom: 0, width: `${pct(selection.to) - pct(selection.from)}%`, background: 'rgba(194,65,12,0.35)', boxShadow: 'inset 0 0 0 2px #C2410C' }} />
          )}
          {handle('start', startAt)}
          {handle('end', endAt)}
          <span style={{ position: 'absolute', left: `${pct(now)}%`, top: 0, bottom: 0, width: 2, background: '#FFFFFF', boxShadow: '0 0 0 1px #111114', pointerEvents: 'none', zIndex: 3 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 11, color: '#6E7079' }}>
          <span>{formatClock(0)}</span><span>{formatClock(duration / 2)}</span><span>{formatClock(duration)}</span>
        </div>
      </div>

      <div style={{ margin: '14px 16px 0', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <button type="button" onClick={() => setEdits((list) => setStart(list, duration, now))} style={plainButton}>Start here</button>
        <button type="button" onClick={cutSelection} disabled={!selection}
          style={{ height: 44, border: 'none', borderRadius: 12, background: '#FFF1EA', font: 'inherit', fontSize: 13, fontWeight: 600, color: '#9A3412', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: selection ? 'pointer' : 'default', opacity: selection ? 1 : 0.5 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" /></svg>Cut a part
        </button>
        <button type="button" onClick={() => setEdits((list) => setEnd(list, duration, now))} style={plainButton}>End here</button>
      </div>

      {list.length > 0 && (
        <div style={{ margin: '16px 16px 0', padding: '4px 14px', borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
          {list.map((edit, i) => (
            <div key={`${edit.kind}${edit.kind === 'cut' ? edit.from : edit.at}`}>
              {i > 0 && <div style={{ height: 1, background: '#EFEFF1' }} />}
              <EditLine edit={edit} onRestore={() => setEdits((current) => restore(current, duration, edit))} />
            </div>
          ))}
        </div>
      )}

      <div style={{ flexGrow: 1 }} />
      <div style={{ margin: '12px 16px 20px', padding: '12px 14px', borderRadius: 12, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 12, color: '#6E7079' }}>New length</span>
          <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 500 }}>{formatLength(editedLength(edits, duration))}</span>
        </span>
        <span style={{ maxWidth: 200, textAlign: 'right', fontSize: 12, lineHeight: 1.45, color: '#5F6168' }}>Nothing is deleted. Cuts apply when you save a copy.</span>
      </div>
    </main>
  );
}
