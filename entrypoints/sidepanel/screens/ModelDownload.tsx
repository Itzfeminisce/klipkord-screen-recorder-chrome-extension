import { useEffect, useState } from 'react';
import { useRouter } from '../router';
import { detectMachine } from '@/lib/setup';
import { BASE_MODEL, LIVE_MODEL, Whisper, megabytes, summarize, timeLeft, track, type DownloadSummary, type FileProgress } from '@/lib/transcribe/whisper';
import { ICONS, Icon, MONO, StateCard } from './Home';

const download = <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />;

type Phase = 'downloading' | 'done' | 'failed';
interface Download { phase: Phase; summary: DownloadSummary; left: string | null }

// Lives with the panel, not the screen: "Start recording" leaves this screen while the download goes on.
let current: Download | null = null;
const listeners = new Set<(d: Download) => void>();
const publish = (d: Download) => {
  current = d;
  listeners.forEach((l) => l(d));
};

/** Downloads whisper-tiny then whisper-base into the browser cache; the offscreen recorder reads them from there. */
function startDownload() {
  if (current?.phase === 'downloading' || current?.phase === 'done') return;
  const files = new Map<string, FileProgress>();
  const whisper = new Whisper(() => new Worker(new URL('../../offscreen/whisper.worker.ts', import.meta.url), { type: 'module' }));
  const started = performance.now();
  // A retry keeps the files already cached, so its bar starts where the last one stopped.
  publish({ phase: 'downloading', summary: current?.summary ?? summarize([]), left: null });
  whisper.onProgress = (p) => {
    track(files, p);
    const summary = summarize(files.values());
    publish({ phase: 'downloading', summary, left: timeLeft(summary.loaded, summary.total, performance.now() - started) });
  };
  void (async () => {
    try {
      for (const model of [LIVE_MODEL, BASE_MODEL]) await whisper.load(model);
      publish({ phase: 'done', summary: summarize(files.values(), 0, true), left: null });
    } catch (error) {
      console.error('Klipkord: could not download the speech model', error);
      publish({ phase: 'failed', summary: current?.summary ?? summarize([]), left: null });
    } finally {
      whisper.terminate();
    }
  })();
}

function useModelDownload() {
  const [download, setDownload] = useState<Download>(() => current ?? { phase: 'downloading', summary: summarize([]), left: null });
  useEffect(() => {
    listeners.add(setDownload);
    startDownload();
    if (current) setDownload(current);
    return () => void listeners.delete(setDownload);
  }, []);
  return { ...download, retry: startDownload };
}

export default function ModelDownload() {
  const { navigate, back } = useRouter();
  const { phase, summary, left, retry } = useModelDownload();
  const [builtinAi, setBuiltinAi] = useState<boolean | null>(null);

  useEffect(() => {
    detectMachine().then((m) => setBuiltinAi(m.builtinAi), () => setBuiltinAi(false));
  }, []);

  const sizeLine = `${megabytes(summary.loaded)} of ${megabytes(summary.total)} MB${phase === 'downloading' && left ? ` · ${left}` : ''}`;

  return (
    <main className="screen" style={{ minHeight: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: '#F6F6F7', color: '#111114' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 0' }}>
        <button type="button" aria-label="Back" onClick={back}
          style={{ width: 36, height: 36, marginLeft: -8, border: 'none', borderRadius: 10, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111114', cursor: 'pointer' }}>
          <Icon><path d="M15 6l-6 6 6 6" /></Icon>
        </button>
        <span style={{ fontFamily: MONO, fontSize: 11, color: '#6E7079' }}>Almost ready</span>
      </div>

      <div style={{ padding: '12px 24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>Getting the AI onto your computer</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#5F6168' }}>This happens once. After that, transcripts and notes work offline.</p>
      </div>

      <div style={{ margin: '22px 24px 0', padding: 16, borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Speech-to-text</span>
            <span style={{ fontFamily: MONO, fontSize: 12, color: '#5F6168' }}>{summary.percent}%</span>
          </div>
          <div role="progressbar" aria-label="Speech-to-text download" aria-valuenow={summary.percent} aria-valuemin={0} aria-valuemax={100}
            style={{ height: 8, borderRadius: 999, background: '#F1F1F3', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${summary.percent}%`, height: '100%', borderRadius: 999, background: '#C2410C', transition: 'width 200ms' }} />
          </div>
          <span style={{ fontSize: 12, color: '#6E7079' }}>{sizeLine}</span>
        </div>
        <>
          <div style={{ height: 1, background: '#EFEFF1' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Note writing</span>
              <span style={{ fontSize: 12, color: '#6E7079' }}>Chrome’s built-in AI</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#15803D' }}>
              {builtinAi && <><Icon size={14}>{ICONS.check}</Icon>Ready</>}
            </span>
          </div>
        </>
      </div>

      {phase === 'failed' && (
        <div style={{ margin: '12px 24px 0' }}>
          <StateCard icon={download} tone="amber" title={`The download stopped at ${summary.percent}%`}
            body="Your connection dropped. Klipkord will carry on from where it stopped."
            action="Try again" onAction={retry} />
        </div>
      )}

      <div style={{ margin: '12px 24px 0', padding: '12px 14px', borderRadius: 12, background: '#FFFFFF', border: '1px solid #E8E8EB', fontSize: 13, lineHeight: 1.45, color: '#44464D' }}>
        You can start recording now. Your transcript catches up as soon as the download finishes.
      </div>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={() => navigate('Home')}
          style={{ height: 48, border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          Start recording
        </button>
        <span style={{ textAlign: 'center', fontSize: 12, color: '#6E7079' }}>Keep this panel open until the download finishes.</span>
      </div>
    </main>
  );
}
