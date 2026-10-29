import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { PROBE_SEEK_SECONDS, needsDurationProbe } from '@/lib/comments';
import { getFolderHandle, getRecording, putFolderHandle, updateRecording } from '@/lib/db';
import { editedLength, playable, toEdited, toOriginal } from '@/lib/editList';
import { ensureAccess, pickFolder, writeFile } from '@/lib/folder';
import { GIF_DELAY_MS, GIF_MAX_MS, GIF_FPS, GIF_WIDTH, checkRange, estimateGifBytes, frameCount, frameTimes, gifFileName, gifHeight, type GifRange } from '@/lib/gifPlan';
import { updateSettings } from '@/lib/settings';
import { formatBytes, formatClock } from '@/lib/time';
import type { Recording } from '@/lib/types';
import { videoStore } from '@/lib/videoStore';
import { Spinner } from '../components';
import { useRouter } from '../router';
import type { GifIn, GifOut } from '../workers/gif';
import { BackBar } from './Export';

const MONO = "'Geist Mono', monospace";
const CARD: CSSProperties = { borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB' };
const OUTLINE: CSSProperties = { height: 44, border: '1px solid #E8E8EB', borderRadius: 12, background: '#FFFFFF', font: 'inherit', fontSize: 13, fontWeight: 500, color: '#111114', cursor: 'pointer' };
const SMALL: CSSProperties = { height: 36, padding: '0 14px', borderRadius: 10, font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const SMALL_OUTLINE: CSSProperties = { ...SMALL, border: '1px solid #E8E8EB', background: '#FFFFFF', color: '#111114', fontWeight: 500 };
const SMALL_DARK: CSSProperties = { ...SMALL, border: 'none', background: '#111114', color: '#FFFFFF' };
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const STRIPS = ['#4A4A52', '#55555D', '#4A4A52', '#55555D', '#4A4A52', '#55555D', '#4A4A52', '#55555D'];

type Phase =
  | { kind: 'idle' }
  | { kind: 'gif-making'; frame: number; total: number }
  | { kind: 'gif-saved'; name: string; size: number; blob: Blob; folder: FileSystemDirectoryHandle }
  | { kind: 'gif-too-long' }
  | { kind: 'gif-failed' };

function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); resolve(); };
    const fail = () => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); reject(new Error('The video could not seek')); };
    video.addEventListener('seeked', done);
    video.addEventListener('error', fail);
    video.currentTime = seconds;
  });
}

/** An unattached video that is ready to seek; recorded files often report no length until a far seek. */
async function openVideo(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('The video could not open'));
  });
  if (needsDurationProbe(video.duration)) {
    await seekTo(video, PROBE_SEEK_SECONDS);
    await seekTo(video, 0);
  }
  return video;
}

/** Draws each frame from the edited video and hands it to the worker; resolves with the GIF. */
async function renderGif(rec: Recording, url: string, range: GifRange, onFrame: (n: number) => void, signal: AbortSignal): Promise<Blob> {
  const times = frameTimes(rec.edits, rec.duration, range);
  const video = await openVideo(url);
  const height = gifHeight(video.videoWidth, video.videoHeight);
  const canvas = document.createElement('canvas');
  canvas.width = GIF_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No canvas');
  const worker = new Worker(new URL('../workers/gif.ts', import.meta.url), { type: 'module' });
  const send = (m: GifIn, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
  try {
    return await new Promise<Blob>((resolve, reject) => {
      let encoded = 0;
      let wake: (() => void) | undefined;
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
      worker.onerror = (e) => reject(new Error(e.message));
      worker.onmessage = (e: MessageEvent<GifOut>) => {
        const m = e.data;
        if (m.type === 'progress') { encoded = m.frames; onFrame(m.frames); wake?.(); }
        else if (m.type === 'done') resolve(new Blob([m.gif], { type: 'image/gif' }));
        else if (m.type === 'error') reject(new Error(m.message));
      };
      send({ type: 'start', width: GIF_WIDTH, height, delayMs: GIF_DELAY_MS });
      (async () => {
        for (let i = 0; i < times.length; i++) {
          // Keep at most a few drawn frames waiting so a long clip does not fill memory.
          while (i - encoded >= 4 && !signal.aborted) await new Promise<void>((r) => { wake = r; });
          if (signal.aborted) return;
          await seekTo(video, times[i]! / 1000);
          ctx.drawImage(video, 0, 0, GIF_WIDTH, height);
          const rgba = ctx.getImageData(0, 0, GIF_WIDTH, height).data.buffer as ArrayBuffer;
          send({ type: 'frame', rgba }, [rgba]);
        }
        send({ type: 'finish' });
      })().catch(reject);
    });
  } finally {
    worker.terminate();
    video.removeAttribute('src');
    video.load();
  }
}

function Card({ tint, icon, title, body, children }: { tint: CSSProperties; icon: ReactNode; title: string; body?: string; children: ReactNode }) {
  return (
    <div role="status" style={{ ...CARD, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <span style={{ width: 32, height: 32, borderRadius: '50%', ...tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          {body && <span style={{ fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>{body}</span>}
        </span>
      </div>
      {children}
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div style={{ padding: '10px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14 }}><span>{label}</span>{children}</div>
);
const RULE = <div style={{ height: 1, background: '#EFEFF1' }} />;
const mono: CSSProperties = { fontFamily: MONO, fontSize: 13 };

export default function GifClip() {
  const { route, back } = useRouter();
  const id = route.params.recordingId;
  const [rec, setRec] = useState<Recording | null | undefined>();
  const [src, setSrc] = useState<string | undefined>();
  const [range, setRange] = useState<GifRange>({ start: 0, end: 0 });
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<'start' | 'end' | null>(null);
  const stop = useRef<AbortController | null>(null);
  const probing = useRef(false);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  useEffect(() => {
    if (!id) return setRec(null);
    getRecording(id).then((r) => {
      setRec(r ?? null);
      if (r) setRange({ start: 0, end: Math.min(GIF_MAX_MS, editedLength(r.edits, r.duration)) });
    }, (error) => { console.error('Klipkord: could not load the recording', error); setRec(null); });
    return () => stop.current?.abort();
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

  const total = rec ? editedLength(rec.edits, rec.duration) : 0;

  const seekEdited = useCallback((ms: number) => {
    const v = video.current;
    if (!rec) return;
    const at = Math.min(total, Math.max(0, ms));
    setNow(at);
    if (v && v.readyState > 0 && !probing.current) v.currentTime = toOriginal(rec.edits, rec.duration, at) / 1000;
  }, [rec, total]);

  const onMetadata = () => {
    const v = video.current;
    if (!v) return;
    if (needsDurationProbe(v.duration)) { probing.current = true; v.currentTime = PROBE_SEEK_SECONDS; }
    else seekEdited(rangeRef.current.start);
  };
  const settle = () => {
    const v = video.current;
    if (v && probing.current && Number.isFinite(v.duration) && v.duration > 0) { probing.current = false; seekEdited(rangeRef.current.start); }
  };
  const onTime = () => {
    const v = video.current;
    if (!v || !rec || probing.current || v.paused) return;
    const ms = v.currentTime * 1000;
    const { at, ended } = playable(rec.edits, rec.duration, ms);
    if (at !== ms) { if (ended) v.pause(); v.currentTime = at / 1000; }
    const edited = toEdited(rec.edits, rec.duration, at);
    setNow(edited);
    if (edited >= rangeRef.current.end) v.pause();
  };

  function toggle() {
    const v = video.current;
    if (!v) return;
    if (!v.paused) return v.pause();
    const r = rangeRef.current;
    if (now < r.start || now >= r.end) seekEdited(r.start);
    v.play().catch((error) => console.error('Klipkord: could not play the video', error));
  }

  const point = (e: PointerEvent) => {
    const box = track.current?.getBoundingClientRect();
    return box && box.width > 0 ? Math.min(total, Math.max(0, ((e.clientX - box.left) / box.width) * total)) : 0;
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    const at = point(e);
    drag.current = Math.abs(at - range.start) <= Math.abs(at - range.end) ? 'start' : 'end';
    e.currentTarget.setPointerCapture?.(e.pointerId);
    move(e);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const at = point(e);
    if (drag.current === 'start') setRange((r) => ({ start: Math.min(at, r.end - GIF_DELAY_MS), end: r.end }));
    else setRange((r) => ({ start: r.start, end: Math.max(at, r.start + GIF_DELAY_MS) }));
    seekEdited(at);
  };
  const up = () => { drag.current = null; };

  if (rec === undefined) return <main className="screen screen-center"><Spinner /></main>;
  if (!rec) return <main className="screen screen-center"><BackBar label="Back" onBack={back} /></main>;
  const r = rec;

  const verdict = checkRange(range);
  const length = range.end - range.start;
  const frames = frameCount(range);
  const pct = (ms: number) => (total > 0 ? (ms / total) * 100 : 0);
  const making = phase.kind === 'gif-making';

  async function chooseFolder() {
    try {
      const picked = await pickFolder();
      if (!picked) return undefined;
      await putFolderHandle(picked);
      await updateSettings({ folderName: picked.name });
      return picked;
    } catch (error) {
      console.error('Klipkord: could not change the save folder', error);
      return undefined;
    }
  }

  async function make() {
    if (verdict === 'gif-too-long') return setPhase({ kind: 'gif-too-long' });
    if (verdict !== 'ok' || !src) return;
    video.current?.pause();
    // The folder pick and its permission both need this click, so they come before the slow work.
    let dir: FileSystemDirectoryHandle | undefined;
    try {
      dir = (await getFolderHandle()) ?? (await chooseFolder());
      if (!dir || !(await ensureAccess(dir, true))) return;
    } catch (error) {
      console.error('Klipkord: could not open the save folder', error);
      return;
    }
    const abort = new AbortController();
    stop.current = abort;
    const clip = { ...range };
    setPhase({ kind: 'gif-making', frame: 0, total: frameTimes(r.edits, r.duration, clip).length });
    try {
      const blob = await renderGif(r, src, clip, (frame) => setPhase((p) => (p.kind === 'gif-making' ? { ...p, frame } : p)), abort.signal);
      const name = gifFileName(r.title, clip.start);
      await writeFile(dir, name, blob);
      await updateRecording(r.id, { savedTo: { folder: dir.name, at: Date.now(), files: [...(r.savedTo?.files ?? []), name] } });
      setPhase({ kind: 'gif-saved', name, size: blob.size, blob, folder: dir });
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return setPhase({ kind: 'idle' });
      console.error('Klipkord: could not make the GIF', error);
      setPhase({ kind: 'gif-failed' });
    }
  }

  // The browser cannot select a file in the file manager, so the picker opens in the folder and shows it.
  async function showInFolder(folder: FileSystemDirectoryHandle) {
    try {
      const open = (globalThis as unknown as { showOpenFilePicker?: (o: object) => Promise<unknown> }).showOpenFilePicker;
      await open?.({ startIn: folder, types: [{ accept: { 'image/gif': ['.gif'] } }] });
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') console.error('Klipkord: could not show the folder', error);
    }
  }
  const copy = (blob: Blob) => navigator.clipboard.write([new ClipboardItem({ 'image/gif': blob })]).catch((error) => console.error('Klipkord: could not copy the GIF', error));

  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      <BackBar label="Back" onBack={back} title="Make a GIF" size={16} />
      <p style={{ margin: '8px 16px 0', fontSize: 13, lineHeight: 1.5, color: '#5F6168' }}>Pick up to 15 seconds. A short clip is easier to drop into a bug report or a chat.</p>

      <div style={{ margin: '12px 16px 0', aspectRatio: '16 / 9', borderRadius: 14, background: '#26262B', position: 'relative', overflow: 'hidden' }}>
        {src && <video ref={video} src={src} muted playsInline preload="auto" onLoadedMetadata={onMetadata} onDurationChange={settle} onSeeked={settle} onTimeUpdate={onTime}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
        <button type="button" aria-label="Play clip" onClick={toggle}
          style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 52, height: 52, border: 'none', borderRadius: '50%', background: 'rgba(17,17,20,0.8)', color: '#FFFFFF', display: playing ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        </button>
        {playing && <button type="button" aria-label="Pause" onClick={toggle} style={{ position: 'absolute', inset: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />}
        <span style={{ position: 'absolute', left: 12, bottom: 12, padding: '4px 8px', borderRadius: 6, background: 'rgba(17,17,20,0.8)', color: '#FFFFFF', fontFamily: MONO, fontSize: 12 }}>{formatClock(now)}</span>
      </div>

      <div style={{ margin: '18px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div ref={track} aria-label="Clip range" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{ position: 'relative', height: 56, borderRadius: 10, background: '#3A3A41', overflow: 'hidden', display: 'flex', touchAction: 'none', cursor: 'ew-resize' }}>
          {STRIPS.map((c, i) => <span key={i} style={{ flex: 1, background: c, borderRight: i < STRIPS.length - 1 ? '1px solid #3A3A41' : undefined }} />)}
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct(range.start)}%`, background: 'rgba(246,246,247,0.82)' }} />
          <span style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${100 - pct(range.end)}%`, background: 'rgba(246,246,247,0.82)' }} />
          <span role="slider" aria-label="Start here" aria-valuemin={0} aria-valuemax={Math.round(total / 1000)} aria-valuenow={Math.round(range.start / 1000)} style={{ position: 'absolute', left: `${pct(range.start)}%`, top: 0, bottom: 0, width: 6, borderRadius: 3, background: '#C2410C' }} />
          <span role="slider" aria-label="End here" aria-valuemin={0} aria-valuemax={Math.round(total / 1000)} aria-valuenow={Math.round(range.end / 1000)} style={{ position: 'absolute', left: `calc(${pct(range.end)}% - 6px)`, top: 0, bottom: 0, width: 6, borderRadius: 3, background: '#C2410C' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 11, color: '#6E7079' }}>
          <span>{formatClock(0)}</span><span>{formatClock(total / 2)}</span><span>{formatClock(total)}</span>
        </div>
      </div>

      <div style={{ margin: '14px 16px 0', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <button type="button" disabled={making} style={OUTLINE} onClick={() => setRange((x) => ({ start: Math.min(now, x.end - GIF_DELAY_MS), end: x.end }))}>Start here</button>
        <button type="button" disabled={making} style={OUTLINE} onClick={() => setRange((x) => ({ start: x.start, end: Math.max(now, x.start + GIF_DELAY_MS) }))}>End here</button>
      </div>

      <div style={{ ...CARD, margin: '16px 16px 0', padding: '4px 14px', display: 'flex', flexDirection: 'column' }}>
        <Row label="Clip"><span style={mono}>{formatClock(range.start)} – {formatClock(range.end)}</span></Row>
        {RULE}
        <Row label="Length"><span><span style={mono}>{Math.round(length / 1000)} s</span> <span style={{ fontSize: 12, color: '#6E7079' }}>of 15 s at most</span></span></Row>
        {RULE}
        <Row label="Size"><span style={mono}>about {formatBytes(estimateGifBytes(range, GIF_WIDTH, gifHeight(1920, 1080)))}</span></Row>
        {RULE}
        <Row label="Quality"><span style={mono}>{GIF_WIDTH} px wide · {GIF_FPS} fps</span></Row>
      </div>

      <div style={{ flexGrow: 1 }} />
      <div style={{ margin: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {phase.kind === 'gif-making' && (
          <Card tint={{ background: '#FFF1EA', color: '#9A3412' }} title="Making your GIF" body="This runs on your computer. Keep this panel open."
            icon={<svg width="16" height="16" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9.5v5l4-2.5z" /></svg>}>
            <div role="progressbar" aria-label="Making your GIF" aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase.total ? Math.round((phase.frame / phase.total) * 100) : 0} style={{ height: 8, borderRadius: 4, background: '#EBEBEE', overflow: 'hidden' }}>
              <div style={{ width: `${phase.total ? (phase.frame / phase.total) * 100 : 0}%`, height: '100%', background: '#C2410C' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: MONO, fontSize: 12, color: '#6E7079' }}>{phase.frame} of {phase.total} frames</span>
              <button type="button" onClick={() => stop.current?.abort()} style={SMALL_OUTLINE}>Cancel</button>
            </div>
          </Card>
        )}
        {phase.kind === 'gif-saved' && (
          <Card tint={{ background: '#ECFDF3', color: '#166534' }} title="GIF saved" body="It is in your Klipkord folder."
            icon={<svg width="16" height="16" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}>
            <div style={{ padding: '10px 12px', borderRadius: 12, background: '#EBEBEE', display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: MONO, fontSize: 12, color: '#44464D' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{phase.name}</span><span>{formatBytes(phase.size)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => void showInFolder(phase.folder)} style={SMALL_DARK}>Show in folder</button>
              <button type="button" onClick={() => void copy(phase.blob)} style={SMALL_OUTLINE}>Copy</button>
            </div>
            <span style={{ fontSize: 12, lineHeight: 1.45, color: '#6E7079' }}>Copy puts the GIF on your clipboard, ready to paste into a chat or a ticket.</span>
          </Card>
        )}
        {phase.kind === 'gif-too-long' && (
          <Card tint={{ background: '#FFF7E6', color: '#92400E' }} title="That clip is longer than 15 seconds" body="GIFs get very large past that. Shorten the clip to 15 seconds or less."
            icon={<svg width="16" height="16" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setPhase({ kind: 'idle' })} style={SMALL_DARK}>Shorten the clip</button>
            </div>
          </Card>
        )}
        {phase.kind === 'gif-failed' && (
          <Card tint={{ background: '#FEF2F2', color: '#B91C1C' }} title="Couldn’t make the GIF" body="Something went wrong while making it. Your recording is unchanged."
            icon={<svg width="16" height="16" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setPhase({ kind: 'idle' })} style={SMALL_DARK}>Try again</button>
              <button type="button" onClick={back} style={SMALL_OUTLINE}>Back to saving</button>
            </div>
          </Card>
        )}
        {phase.kind !== 'gif-making' && (
          <>
            <button type="button" onClick={() => void make()} disabled={verdict === 'empty' || !src}
              style={{ height: 48, border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, opacity: verdict === 'empty' ? 0.5 : 1, cursor: 'pointer' }}>Make GIF</button>
            <span style={{ fontSize: 12, lineHeight: 1.45, color: '#6E7079', textAlign: 'center' }}>The GIF has no sound. It is saved in your Klipkord folder and the recording stays as it is.</span>
          </>
        )}
      </div>
    </main>
  );
}
