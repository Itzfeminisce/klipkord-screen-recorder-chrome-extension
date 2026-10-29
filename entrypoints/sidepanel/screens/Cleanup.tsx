import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { getRecording, updateRecording } from '@/lib/db';
import { cut, editedLength, keptRanges, playable } from '@/lib/editList';
import { findFillers } from '@/lib/fillers';
import { WINDOW_MS, rmsLevels, silenceRanges } from '@/lib/silence';
import { getSettings, updateSettings } from '@/lib/settings';
import { formatClock } from '@/lib/time';
import { hasWords } from '@/lib/transcribe/merge';
import { SAMPLE_RATE } from '@/lib/transcribe/chunker';
import { readVoice } from '@/lib/transcribe/voice';
import type { CleanupItem, KeptRange, Recording, Settings } from '@/lib/types';
import { videoStore } from '@/lib/videoStore';
import { Retranscribe, retranscribeReason } from '../components/Retranscribe';
import { useRouter } from '../router';

const MONO = "'Geist Mono', monospace";
const card: CSSProperties = { borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB' };
const PAUSES = [1, 2, 3] as const;

/** Applies each ticked item as a cut on top of `edits`. */
function applyItems(edits: KeptRange[], duration: number, items: CleanupItem[]): KeptRange[] {
  return items.filter((i) => i.on).reduce((acc, i) => cut(acc, duration, i.start, i.end), edits);
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const minSec = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      style={{ all: 'unset', cursor: 'pointer', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ position: 'relative', width: 40, height: 24, borderRadius: 999, background: on ? '#111114' : '#D4D4D8' }}>
        <span style={{ position: 'absolute', [on ? 'right' : 'left']: 2, top: 2, width: 20, height: 20, borderRadius: '50%', background: '#FFFFFF' }} />
      </span>
    </button>
  );
}

function Row({ title, note, on, onChange }: { title: string; note: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>
        <span style={{ fontSize: 12, color: '#5F6168' }}>{note}</span>
      </span>
      <Switch label={title} on={on} onChange={onChange} />
    </div>
  );
}

const chip = (kind: CleanupItem['kind']): CSSProperties => ({
  padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, flexShrink: 0,
  background: kind === 'pause' ? '#FFF1EA' : '#EEF2FF', color: kind === 'pause' ? '#9A3412' : '#3730A3',
});

export default function Cleanup() {
  const { route, back, canGoBack, replace } = useRouter();
  const id = route.params.recordingId;
  const [rec, setRec] = useState<Recording | null>(null);
  const [settings, setSettings] = useState<Settings['cleanup'] | null>(null);
  const [levels, setLevels] = useState<number[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  const [src, setSrc] = useState<string | undefined>();
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const firstLength = useRef<HTMLButtonElement>(null);
  const duration = rec?.duration ?? 0;

  useEffect(() => {
    if (!id) return;
    getRecording(id).then((r) => setRec(r ?? null), (error) => console.error('Klipkord: could not load the recording', error));
    getSettings().then((s) => setSettings(s.cleanup), (error) => console.error('Klipkord: could not read the settings', error));
    // Levels come from the saved voice track here in the side panel, not from the offscreen page.
    readVoice(id).then((v) => setLevels(rmsLevels(v, SAMPLE_RATE)), (error) => { console.error('Klipkord: could not read the voice track', error); setLevels([]); });
  }, [id]);

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

  const minPause = settings?.minPause ?? 2;
  const needsWords = !!rec && rec.transcript.length > 0 && !hasWords(rec.transcript);

  // Everything found, whatever the switches say; parts already cut are left out.
  const found = useMemo<CleanupItem[]>(() => {
    if (!rec || !levels) return [];
    const kept = keptRanges(rec.edits, duration);
    const inKept = (a: number, b: number) => kept.some((r) => a < r.end && b > r.start);
    const pauses = silenceRanges(levels, WINDOW_MS, minPause * 1000).map<CleanupItem>((r) => ({ id: `pause-${r.start}`, kind: 'pause', start: r.start, end: r.end, text: 'Silence', on: true }));
    const fillers = findFillers(rec.transcript).map<CleanupItem>((f) => ({ id: `filler-${f.start}`, kind: 'filler', start: f.start, end: f.end, text: f.text, on: true }));
    return [...pauses, ...fillers].filter((i) => inKept(i.start, i.end)).sort((a, b) => a.start - b.start);
  }, [rec, levels, duration, minPause]);

  const pauseCount = found.filter((i) => i.kind === 'pause').length;
  const fillerCount = found.length - pauseCount;
  const items = useMemo(
    () => found.filter((i) => (i.kind === 'pause' ? settings?.pauses : settings?.fillers)).map((i) => ({ ...i, on: !off.has(i.id) })),
    [found, settings?.pauses, settings?.fillers, off],
  );
  const ticked = items.filter((i) => i.on);
  const after = useMemo(() => (rec ? applyItems(rec.edits, duration, items) : []), [rec, duration, items]);
  const saved = rec ? editedLength(rec.edits, duration) - editedLength(after, duration) : 0;

  async function change(patch: Partial<Settings['cleanup']>) {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setOff(new Set());
    try { await updateSettings({ cleanup: patch }); } catch (error) { console.error('Klipkord: could not save the settings', error); }
  }

  const leave = () => (canGoBack ? back() : replace('Trim', { recordingId: id }));

  async function apply() {
    if (!id || !rec || saving) return;
    setSaving(true);
    try {
      await updateRecording(id, (r) => ({ edits: applyItems(r.edits, r.duration, items) }));
      leave();
    } catch (error) {
      console.error('Klipkord: could not save the cuts', error);
      setSaving(false);
    }
  }

  function preview() {
    const v = video.current;
    if (!v) return;
    if (!v.paused) { v.pause(); return; }
    v.currentTime = playable(after, duration, 0).at / 1000;
    v.play().catch((error) => console.error('Klipkord: could not play the video', error));
  }
  function onTime() {
    const v = video.current;
    if (!v || v.paused) return;
    const ms = v.currentTime * 1000;
    const { at, ended } = playable(after, duration > 0 ? duration : Infinity, ms);
    if (ended) v.pause();
    if (at !== ms) v.currentTime = at / 1000;
  }

  const loading = !rec || !settings || !levels;
  const nothing = !loading && items.length === 0;
  const prompt = !!rec && needsWords && settings?.fillers && !dismissed;

  return (
    <div style={{ minHeight: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: '#F6F6F7', color: '#111114' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px 0', gap: 8 }}>
        <button type="button" onClick={leave} style={{ height: 44, padding: '0 8px', border: 'none', background: 'transparent', borderRadius: 12, color: '#44464D', font: 'inherit', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
        <h1 style={{ flexGrow: 1, margin: 0, textAlign: 'center', fontSize: 16, fontWeight: 600 }}>Silences and fillers</h1>
        <span style={{ width: 64 }} />
      </div>

      {!loading && !nothing && (
        <p style={{ margin: '8px 24px 0', fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>Klipkord found {items.length} {items.length === 1 ? 'thing' : 'things'} you can cut. Untick any you want to keep.</p>
      )}

      {prompt && rec && (
        <div style={{ margin: '12px 16px 0' }}>
          <Retranscribe recording={rec} reason={retranscribeReason(rec) ?? 'live'} onDone={(r) => setRec(r)} onDismiss={() => setDismissed(true)} />
        </div>
      )}

      {settings && (
        <div style={{ ...card, margin: '12px 16px 0', padding: '4px 14px 14px', display: 'flex', flexDirection: 'column' }}>
          <Row title="Long pauses" note={`${pauseCount} found`} on={settings.pauses} onChange={(pauses) => change({ pauses })} />
          <div role="group" aria-label="Shortest pause to cut" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#6E7079' }}>Shortest pause to cut</span>
            <span style={{ display: 'flex', gap: 8 }}>
              {PAUSES.map((n) => {
                const active = n === minPause;
                return (
                  <button key={n} ref={n === 1 ? firstLength : undefined} type="button" aria-pressed={active} onClick={() => change({ minPause: n })}
                    style={{ height: 44, flex: 1, borderRadius: 10, font: 'inherit', fontSize: 13, cursor: 'pointer', background: active ? '#111114' : '#FFFFFF', color: active ? '#FFFFFF' : '#111114', fontWeight: active ? 600 : 500, border: active ? 'none' : '1px solid #E8E8EB' }}>
                    {n} {n === 1 ? 'second' : 'seconds'}
                  </button>
                );
              })}
            </span>
          </div>
          <div style={{ height: 1, background: '#EFEFF1', margin: '12px 0 4px' }} />
          <Row title="Filler words" note={`${fillerCount} found · um, uh, er, you know, and like at the start of a phrase. English only.`} on={settings.fillers} onChange={(fillers) => change({ fillers })} />
        </div>
      )}

      {nothing && (
        <div style={{ ...card, margin: '12px 16px 0', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#F1F1F3', color: '#44464D', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
            </span>
            <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>No pauses or fillers found</span>
              <span style={{ fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>Nothing in this recording has a pause of {minPause} {minPause === 1 ? 'second' : 'seconds'} or more, or a um, uh, er, you know or like at the start of a phrase. Try a shorter pause, or go back to Trim.</span>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => firstLength.current?.focus()} style={{ height: 44, padding: '0 16px', border: '1px solid #E8E8EB', borderRadius: 10, background: '#FFFFFF', color: '#111114', font: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Change pause length</button>
            <button type="button" onClick={leave} style={{ height: 44, padding: '0 16px', border: 'none', borderRadius: 10, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Back to Trim</button>
          </div>
        </div>
      )}

      {!loading && !nothing && (
        <>
          <video ref={video} src={src} hidden playsInline preload="auto" onTimeUpdate={onTime} onPlay={() => setPreviewing(true)} onPause={() => setPreviewing(false)} onEnded={() => setPreviewing(false)} />
          <button type="button" onClick={preview} aria-pressed={previewing} disabled={!src}
            style={{ margin: '12px 16px 0', height: 44, border: '1px solid #E8E8EB', borderRadius: 12, background: '#FFFFFF', font: 'inherit', fontSize: 14, fontWeight: 500, color: '#111114', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#111114" aria-hidden="true"><path d="M8 5l12 7-12 7z" /></svg>Preview with these cuts
          </button>

          <div style={{ padding: '14px 24px 4px', fontSize: 12, fontWeight: 600, color: '#6E7079' }}>What was found</div>
          <div style={{ ...card, flexGrow: 1, minHeight: 0, overflowY: 'auto', margin: '0 16px', padding: '2px 10px', display: 'flex', flexDirection: 'column' }}>
            {items.map((i) => (
              <label key={i.id} style={{ minHeight: 44, padding: '0 4px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
                <input type="checkbox" aria-label={`Cut ${i.kind} at ${formatClock(i.start)}`} checked={i.on}
                  onChange={() => setOff((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })}
                  style={{ width: 20, height: 20, margin: 0, accentColor: '#C2410C', flexShrink: 0 }} />
                <span style={{ fontFamily: MONO, fontSize: 12, color: '#6E7079', width: 40, flexShrink: 0 }}>{formatClock(i.start)}</span>
                <span style={chip(i.kind)}>{i.kind === 'pause' ? 'Pause' : 'Filler'}</span>
                <span style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.kind === 'filler' ? `“${i.text}”` : i.text}</span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: '#5F6168' }}>{seconds(i.end - i.start)}</span>
              </label>
            ))}
          </div>

          <div style={{ ...card, margin: '12px 16px 20px', padding: '12px 14px', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12, color: '#6E7079' }}>Time saved</span>
              <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 500 }}>{minSec(saved)}</span>
            </span>
            <button type="button" onClick={apply} disabled={ticked.length === 0 || saving}
              style={{ height: 44, padding: '0 20px', border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: ticked.length === 0 ? 0.5 : 1 }}>Cut {ticked.length}</button>
          </div>
        </>
      )}
    </div>
  );
}
