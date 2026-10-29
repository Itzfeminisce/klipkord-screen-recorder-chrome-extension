import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { formatLength } from '@/lib/comments';
import { getRecording, updateRecording } from '@/lib/db';
import { editedLength } from '@/lib/editList';
import { formatClock } from '@/lib/time';
import type { KeptRange, Recording } from '@/lib/types';
import { deleteWords, isCut, restoreWords, units, wordCount, type Unit } from '@/lib/wordCuts';
import { Retranscribe, retranscribeReason, type RetranscribeReason } from '../components/Retranscribe';
import { useRouter } from '../router';

const MONO = "'Geist Mono', monospace";
const wordStyle: CSSProperties = { all: 'unset', cursor: 'pointer', padding: '2px 1px', borderRadius: 4 };
const pickedStyle: CSSProperties = { all: 'unset', cursor: 'pointer', padding: '2px 1px', background: '#FFE0CF', color: '#111114', boxShadow: '0 0 0 1px #FFE0CF' };
const restoreStyle: CSSProperties = {
  height: 28, padding: '0 8px', marginLeft: 4, border: 'none', borderRadius: 8, background: 'transparent', font: 'inherit', fontSize: 12, fontWeight: 500, color: '#C2410C', verticalAlign: 'baseline', cursor: 'pointer',
};

interface Selection { anchor: number; from: number; to: number }

// "Um," → "um", as the frame's aria-labels read.
const restoreLabel = (text: string) => `Restore ${text.charAt(0).toLowerCase()}${text.slice(1).replace(/[.,!?;:]+$/, '')}`;

export default function EditTranscript() {
  const { route, back, canGoBack, replace } = useRouter();
  const id = route.params.recordingId;
  const [rec, setRec] = useState<Recording | null>(null);
  const [edits, setEdits] = useState<KeptRange[]>([]);
  const [pick, setPick] = useState<Selection | null>(null);
  const [prompt, setPrompt] = useState<RetranscribeReason | null>(null);
  const [saving, setSaving] = useState(false);
  const dragging = useRef(false);
  const duration = rec?.duration ?? 0;

  useEffect(() => {
    if (!id) return;
    getRecording(id).then((r) => {
      setRec(r ?? null);
      setEdits(r?.edits ?? []);
      setPrompt(r ? retranscribeReason(r) : null);
    }, (error) => console.error('Klipkord: could not load the recording', error));
  }, [id]);

  const words = useMemo(() => units(rec?.transcript ?? []), [rec?.transcript]);
  const cutMask = useMemo(() => words.map((w) => isCut(edits, duration, w)), [words, edits, duration]);

  useEffect(() => {
    const stop = () => { dragging.current = false; };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => { window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
  }, []);

  const chosen = useMemo(() => {
    const set = new Set<number>();
    if (pick) for (let i = pick.from; i <= pick.to; i++) if (!cutMask[i]) set.add(i);
    return set;
  }, [pick, cutMask]);

  function extend(i: number) {
    setPick((p) => (p ? { anchor: p.anchor, from: Math.min(p.anchor, i), to: Math.max(p.anchor, i) } : { anchor: i, from: i, to: i }));
  }
  function overWord(x: number, y: number) {
    if (!dragging.current) return;
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-word]');
    const i = el ? Number(el.dataset.word) : NaN;
    if (Number.isInteger(i)) extend(i);
  }

  function remove() {
    setEdits((list) => deleteWords(list, duration, words, chosen));
    setPick(null);
  }

  const toTrim = () => (canGoBack ? back() : replace('Trim', { recordingId: id }));
  async function done() {
    if (!id || saving) return;
    setSaving(true);
    try {
      await updateRecording(id, { edits });
      // Trim sits between Review and here.
      if (canGoBack) { back(); back(); } else replace('Review', { recordingId: id });
    } catch (error) {
      console.error('Klipkord: could not save the edits', error);
      setSaving(false);
    }
  }

  if (!rec) return <main className="screen" style={{ height: '100vh' }} />;

  const picked = [...chosen];
  const first = picked.length ? words[picked[0]!] : undefined;
  const last = picked.length ? words[picked[picked.length - 1]!] : undefined;

  const lines = rec.transcript.map((seg, line) => {
    const parts: ReactNode[] = [];
    const idx = words.flatMap((w, i) => (w.line === line ? [i] : []));
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k]!;
      if (cutMask[i]) {
        let j = k;
        while (j + 1 < idx.length && cutMask[idx[j + 1]!]) j++;
        const text = idx.slice(k, j + 1).map((n) => words[n]!.text).join(' ');
        const from = i;
        const to = idx[j]!;
        if (parts.length) parts.push(' ');
        parts.push(<span key={`c${i}`} style={{ textDecoration: 'line-through', color: '#6E7079' }}>{text}</span>);
        parts.push(<button key={`r${i}`} type="button" aria-label={restoreLabel(text)} onClick={() => setEdits((list) => restoreWords(list, duration, words, from, to))} style={restoreStyle}>Restore</button>);
        k = j;
        continue;
      }
      const w: Unit = words[i]!;
      const on = chosen.has(i);
      if (parts.length) parts.push(' ');
      parts.push(
        <button key={`w${i}`} type="button" data-word={i} aria-pressed={on || undefined} style={on ? pickedStyle : wordStyle}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            dragging.current = true;
            if (e.shiftKey && pick) extend(i); else setPick({ anchor: i, from: i, to: i });
          }}
          onClick={(e) => {
            // Keyboard only: a pointer already picked the word on pointerdown.
            if (e.detail !== 0) return;
            if (e.shiftKey && pick) extend(i); else setPick({ anchor: i, from: i, to: i });
          }}>{w.text}</button>,
      );
    }
    const active = idx.some((i) => chosen.has(i));
    return (
      <div key={`${seg.start}-${line}`} style={{ padding: 8, borderRadius: 10, display: 'flex', gap: 12, background: active ? '#FFF8F4' : undefined }}>
        <span style={{ fontFamily: MONO, fontSize: 12, color: '#6E7079', paddingTop: 2, flexShrink: 0 }}>{formatClock(seg.start)}</span>
        <span style={{ flexGrow: 1 }}>{parts}</span>
      </div>
    );
  });

  const count = wordCount(words, picked);

  return (
    <main className="screen" style={{ height: '100vh', minHeight: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: '#F6F6F7', color: '#111114' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px 0', gap: 8 }}>
        <button type="button" onClick={toTrim}
          style={{ height: 44, padding: '0 8px', border: 'none', borderRadius: 12, background: 'none', color: '#44464D', font: 'inherit', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
        <h1 style={{ flexGrow: 1, margin: 0, textAlign: 'center', fontSize: 16, fontWeight: 600 }}>Edit by transcript</h1>
        <button type="button" onClick={done} disabled={saving}
          style={{ height: 36, padding: '0 14px', border: 'none', borderRadius: 10, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Done</button>
      </div>

      <div style={{ padding: '10px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 12, lineHeight: 1.45, color: '#5F6168' }}>Tap a word, then drag to select more. Deleting cuts that part of the video.</span>
      </div>

      {prompt ? (
        <div style={{ margin: '10px 16px 0' }}>
          <Retranscribe recording={{ ...rec, edits }} reason={prompt}
            onDone={(r) => { setRec({ ...r, edits }); setPick(null); setPrompt(null); }} onDismiss={() => setPrompt(null)} />
        </div>
      ) : (
        <div style={{ margin: '10px 16px 0', padding: '10px 12px', borderRadius: 12, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, lineHeight: 1.45, color: '#5F6168' }}>Times look off after your cuts?</span>
          <button type="button" onClick={() => setPrompt('cuts')}
            style={{ minHeight: 44, padding: 0, border: 'none', background: 'none', display: 'flex', alignItems: 'center', font: 'inherit', fontSize: 13, fontWeight: 500, color: '#C2410C', cursor: 'pointer' }}>Re-transcribe</button>
        </div>
      )}

      <div onPointerMove={(e) => overWord(e.clientX, e.clientY)}
        style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', marginTop: 8, padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 15, lineHeight: 1.7, userSelect: 'none' }}>
        {lines}
      </div>

      {first && last && (
        <div style={{ margin: '8px 16px 0', padding: '10px 12px', borderRadius: 14, background: '#111114', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{count} {count === 1 ? 'word' : 'words'} selected</span>
            <span style={{ fontFamily: MONO, fontSize: 12, color: '#C9CAD1' }}>{formatClock(first.start)} – {formatClock(last.end)}</span>
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setPick(null)}
              style={{ height: 44, padding: '0 12px', border: '1px solid #44464D', borderRadius: 12, background: 'transparent', font: 'inherit', fontSize: 13, fontWeight: 500, color: '#FFFFFF', cursor: 'pointer' }}>Clear</button>
            <button type="button" onClick={remove}
              style={{ height: 44, padding: '0 14px', border: 'none', borderRadius: 12, background: '#C2410C', font: 'inherit', fontSize: 13, fontWeight: 600, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>Delete
            </button>
          </span>
        </div>
      )}

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
