import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { askRecording, ENGINE_FOOTER, type AskResult } from '@/lib/ask';
import { loadKeys } from '@/lib/keys';
import { availableEngines } from '@/lib/notes/engines';
import { getSettings } from '@/lib/settings';
import { formatClock } from '@/lib/time';
import type { ReviewContext } from '../components/Player';
import { useRouter } from '../router';

const MONO = "var(--mono, 'Geist Mono', monospace)";
const SUGGESTIONS = ['What was decided?', 'What are the steps to reproduce?', 'Who was this for?'];
const CHIP: CSSProperties = {
  height: 28, padding: '0 8px', border: 'none', borderRadius: 8, background: '#FFF1EA', color: '#9A3412', fontFamily: MONO, fontSize: 12,
  fontWeight: 500, display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', cursor: 'pointer',
};
const CARD: CSSProperties = { padding: 14, borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', gap: 10 };
const PRIMARY: CSSProperties = {
  alignSelf: 'flex-start', height: 36, padding: '0 14px', border: 'none', borderRadius: 10, background: '#111114', color: '#FFFFFF', font: 'inherit',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const SECONDARY: CSSProperties = { ...PRIMARY, background: '#FFFFFF', border: '1px solid #E8E8EB', color: '#111114', boxSizing: 'border-box' };

export const askTab = (ctx: ReviewContext) => <Ask {...ctx} />;

function Notice({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children: React.ReactNode }) {
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', gap: 12 }}>
        <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#F1F1F3', color: '#44464D', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>{body}</span>
        </span>
      </div>
      {children}
    </div>
  );
}

function Ask({ rec, seek }: ReviewContext) {
  const { navigate, replace } = useRouter();
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const run = useRef<AbortController | null>(null);

  const deps = async () => ({ settings: await getSettings(), keys: await loadKeys().catch(() => ({})), fetchFn: (i: string, init?: RequestInit) => fetch(i, init) });

  useEffect(() => {
    let live = true;
    deps().then(availableEngines).then((e) => { if (live) { setReady(e.length > 0); setEngine(e[0]?.id ?? null); } })
      .catch((error) => { console.error('Klipkord: could not check the AI', error); if (live) setReady(false); });
    return () => { live = false; run.current?.abort(); };
  }, []);

  async function send(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    run.current?.abort();
    const ctl = new AbortController();
    run.current = ctl;
    setAsked(text); setQuestion(''); setResult(null); setBusy(true);
    try {
      const r = await askRecording(rec.title, rec.transcript, text, await deps(), ctl.signal);
      if (ctl.signal.aborted) return;
      setResult(r);
      if (r.kind === 'answer') setEngine(r.answer.engine);
    } catch (error) {
      if (!ctl.signal.aborted) { console.error('Klipkord: could not answer the question', error); setResult({ kind: 'no-answer' }); }
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  }

  const jump = (ms: number) => { seek(ms); replace('Review', { recordingId: rec.id, atMs: ms }); };
  const time = (ms: number) => <button key={ms} type="button" aria-label={`Jump to ${formatClock(ms)}`} onClick={() => jump(ms)} style={CHIP}>{formatClock(ms)}</button>;

  // Break the answer text at its [mm:ss] citations so each becomes a chip.
  function withChips(text: string, times: number[]) {
    return text.split(/(\[\d{1,3}:\d{2}(?::\d{2})?\])/).map((part, i) => {
      const m = /^\[(\d{1,3}):(\d{2})(?::(\d{2}))?\]$/.exec(part);
      if (!m) return part;
      const ms = (m[3] === undefined ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
      return times.includes(ms) ? <span key={i}>{time(ms)}</span> : null;
    });
  }

  const notSetUp = ready === false || result?.kind === 'not-set-up';

  return (
    <>
      <div style={{ flexGrow: 1, minHeight: 0, overflow: 'auto', padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {asked && (
          <div style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: '10px 14px', borderRadius: '16px 16px 4px 16px', background: '#111114', color: '#FFFFFF', fontSize: 14, lineHeight: 1.45 }}>{asked}</div>
        )}
        {busy && <div role="status" aria-label="Answering" style={{ ...CARD, height: 48 }} />}
        {result?.kind === 'answer' && (
          <div style={{ ...CARD, borderRadius: 14, gap: 12 }}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>{withChips(result.answer.text, result.answer.times)}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#5F6168' }}>Where this comes from</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{result.answer.times.map(time)}</div>
            </div>
          </div>
        )}
        {result?.kind === 'no-answer' && (
          <Notice title="This recording doesn’t say" body="The transcript doesn’t answer that. Try asking it another way, or search the transcript for a word."
            icon={<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></>}>
            <button type="button" style={PRIMARY} onClick={() => replace('ReviewTranscript', { recordingId: rec.id })}>Open the transcript</button>
          </Notice>
        )}
        {notSetUp && (
          <Notice title="Set up AI to ask questions" body="Ask needs an AI to read the transcript. Run it on this computer, or connect Penv Cloud to use a key you already have there."
            icon={<><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={{ ...PRIMARY, alignSelf: 'auto' }} onClick={() => navigate('ModelDownload', { recordingId: rec.id })}>Set up on this computer</button>
              <button type="button" style={{ ...SECONDARY, alignSelf: 'auto' }} onClick={() => navigate('PenvConnect', { recordingId: rec.id })}>Connect Penv Cloud</button>
            </div>
          </Notice>
        )}
        {!notSetUp && !busy && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#5F6168', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Try asking</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)}
                  style={{ minHeight: 36, padding: '6px 12px', border: '1px solid #E8E8EB', borderRadius: 999, background: '#FFFFFF', color: '#111114', font: 'inherit', fontSize: 13, fontWeight: 500, textAlign: 'left', cursor: 'pointer' }}>{s}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(question); }} style={{ margin: '10px 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ flexGrow: 1, minWidth: 0 }}>
          <input type="text" aria-label="Ask a question about this recording" placeholder="Ask about this recording" value={question} onChange={(e) => setQuestion(e.target.value)}
            style={{ width: '100%', height: 44, padding: '0 14px', boxSizing: 'border-box', border: '1px solid #E8E8EB', borderRadius: 12, background: '#FFFFFF', font: 'inherit', fontSize: 14, color: '#111114' }} />
        </label>
        <button type="submit" aria-label="Send question" disabled={busy}
          style={{ width: 44, height: 44, border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
      <div style={{ padding: '10px 16px 16px', fontSize: 12, color: '#6E7079' }}>{engine ? ENGINE_FOOTER[engine] : ''}</div>
    </>
  );
}
