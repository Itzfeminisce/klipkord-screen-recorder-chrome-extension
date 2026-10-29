import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from '../router';
import { BubbleControls, BubblePreview, useCamera } from '../components/BubblePreview';
import { getSettings, onSettingsChanged, updateSettings } from '@/lib/settings';
import { listRecordings } from '@/lib/db';
import { command, onStartRequest, takeStartRequest, useRecorder } from '@/lib/capture';
import { meterBars, rms } from '@/lib/mix';
import { shortClock } from '@/lib/recorder';
import type { CaptureMode, NoteStyle, Quality, Recording, Settings } from '@/lib/types';
import { useOffline } from './Offline';

export const MONO = 'var(--mono)';

/** Inline SVG icon from frame markup (24px grid, stroked). */
export function Icon({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const ICONS = {
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  micOff: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18" /></>,
  camera: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></>,
  sound: <path d="M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />,
  noSound: <path d="M11 5L6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6" />,
  tab: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18" /></>,
  window: <path d="M3 19V8a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8z" />,
  screen: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  library: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  settings: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  pause: <path d="M9 5v14M15 5v14" />,
  play: <path d="M7 5l12 7-12 7z" />,
  check: <path d="M5 12l5 5 9-10" />,
  recover: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  warn: <path d="M12 3l10 18H2zM12 10v5M12 18h0" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
};

/** Orange brand mark and name, as the recording frames draw it. */
export function Brand({ right, padding = '20px 24px 0' }: { right?: ReactNode; padding?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: '#C2410C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FFFFFF' }} />
      </span>
      <span style={{ flexGrow: 1, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>Klipkord</span>
      {right}
    </div>
  );
}

type Tone = 'red' | 'amber' | 'grey' | 'dark-amber' | 'dark-grey';
const TONES: Record<Tone, [string, string]> = {
  red: ['#FEF2F2', '#B91C1C'], amber: ['#FFF7E6', '#92400E'], grey: ['#F1F1F3', '#44464D'], 'dark-amber': ['#3B2A0E', '#FBBF24'], 'dark-grey': ['#26262B', '#D4D5DA'],
};

/** A StatesRecording card: light on light screens, dark on dark ones, with one action. */
export function StateCard({ icon, tone, title, body, action, onAction, dark }: {
  icon: ReactNode; tone: Tone; title: string; body: string; action: string; onAction: () => void; dark?: boolean;
}) {
  const [bg, fg] = TONES[tone];
  return (
    <div role="status" style={{ padding: 14, borderRadius: 16, background: dark ? '#1A1A1F' : '#FFFFFF', border: dark ? 'none' : '1px solid #E8E8EB', color: dark ? '#F6F6F7' : '#111114', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <span style={{ width: 32, height: 32, borderRadius: '50%', background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={16}>{icon}</Icon></span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: dark ? '#B4B5BC' : '#5F6168' }}>{body}</span>
        </span>
      </div>
      <button type="button" onClick={onAction} style={{ alignSelf: 'flex-start', height: 36, padding: '0 14px', border: 'none', borderRadius: 10, background: dark ? '#F6F6F7' : '#111114', color: dark ? '#111114' : '#FFFFFF', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{action}</button>
    </div>
  );
}

export const STYLE_NAMES: Record<NoteStyle, string> = {
  howto: 'How-to guide', bug: 'Bug report', update: 'Update', meeting: 'Meeting', general: 'General',
};

/** "Today, 10:20" / "Yesterday, 16:35" / "12 Oct, 09:05". */
export function dayAndTime(at: number, now = Date.now()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = (t: number) => new Date(t).toDateString();
  if (day(at) === day(now)) return `Today, ${time}`;
  if (day(at) === day(now - 86_400_000)) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

const MODES: { mode: CaptureMode; label: string; icon: ReactNode }[] = [
  { mode: 'tab', label: 'A tab', icon: ICONS.tab },
  { mode: 'window', label: 'A window', icon: ICONS.window },
  { mode: 'screen', label: 'Whole screen', icon: ICONS.screen },
];
export const MODE_LABEL: Record<CaptureMode, string> = { tab: 'A tab', window: 'A window', screen: 'Whole screen' };

const SEGMENTS: CSSProperties = { display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: '#EBEBEE' };
const segment = (on: boolean): CSSProperties => ({
  height: 28, padding: '0 10px', border: 'none', borderRadius: 6, font: 'inherit', fontSize: 12, cursor: 'pointer',
  ...(on ? { background: '#FFFFFF', boxShadow: '0 1px 2px rgba(16,16,20,0.08)', fontWeight: 600, color: '#111114' } : { background: 'transparent', color: '#5F6168' }),
});
const DIVIDER = <div style={{ height: 1, background: '#EFEFF1', margin: '0 14px' }} />;
const ROW: CSSProperties = { padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 };
const ICON_LINK: CSSProperties = { width: 44, height: 44, borderRadius: 12, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#44464D', cursor: 'pointer' };

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle}
      style={{ width: 40, height: 24, border: 'none', borderRadius: 999, background: on ? '#C2410C' : '#DCDCE0', position: 'relative', flexShrink: 0, cursor: 'pointer' }}>
      <span style={{ position: 'absolute', top: 3, [on ? 'right' : 'left']: 3, width: 18, height: 18, borderRadius: '50%', background: '#FFFFFF' }} />
    </button>
  );
}

/** Opens the mic while Home shows, for the level meter and the device name; every track stops on leave. */
function useMicMeter(enabled: boolean) {
  const [level, setLevel] = useState(0);
  const [name, setName] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let live = true;
    (async () => {
      try {
        const status = await navigator.permissions.query({ name: 'microphone' as PermissionName }).catch(() => null);
        if (status?.state === 'denied') return live && setBlocked(true);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!live) return stream.getTracks().forEach((t) => t.stop());
        setBlocked(false);
        setName(stream.getAudioTracks()[0]?.label || null);
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        timer = setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          setLevel(rms(buf));
        }, 100);
      } catch (error) {
        if ((error as { name?: string }).name === 'NotAllowedError') setBlocked(true);
        else console.error('Klipkord: could not open the microphone', error);
      }
    })();
    return () => {
      live = false;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => undefined);
      setLevel(0);
    };
  }, [enabled]);
  return { level, name, blocked };
}

export default function Home() {
  const { navigate, replace } = useRouter();
  const recorder = useRecorder();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [last, setLast] = useState<Recording | null>(null);
  const capture = settings?.capture;
  const meter = useMicMeter(Boolean(capture?.mic));
  const camera = useCamera(Boolean(capture?.camera));

  useEffect(() => {
    getSettings().then(setSettings, (error) => console.error('Klipkord: could not read settings', error));
    listRecordings()
      .then((all) => setLast(all.find((r) => r.status !== 'unfinished' && r.status !== 'recording' && r.status !== 'paused') ?? null))
      .catch((error) => console.error('Klipkord: could not list recordings', error));
    return onSettingsChanged(setSettings);
  }, []);

  // Panel reopened mid-recording: go straight back to it.
  useEffect(() => {
    if (recorder?.status === 'recording') replace('Recording', { recordingId: recorder.recordingId });
    else if (recorder?.status === 'paused') replace('Paused', { recordingId: recorder.recordingId });
  }, [recorder, replace]);

  // Cloud AI with no network: the Offline screen (T6).
  const offline = useOffline();
  useEffect(() => {
    if (offline) replace('Offline');
  }, [offline, replace]);

  const start = useCallback(() => navigate('Countdown'), [navigate]);

  // Alt+Shift+R from any tab.
  useEffect(() => {
    const take = () => void takeStartRequest().then((yes) => yes && start(), (error) => console.error('Klipkord: could not read the start request', error));
    take();
    return onStartRequest(take);
  }, [start]);

  function setCapture(patch: Partial<Settings['capture']>) {
    if (!settings) return;
    setSettings({ ...settings, capture: { ...settings.capture, ...patch } });
    updateSettings({ capture: patch }).catch((error) => console.error('Klipkord: could not save capture settings', error));
  }

  function setBubble(patch: Partial<Settings['bubble']>) {
    if (!settings) return;
    const bubble = { ...settings.bubble, ...patch };
    setSettings({ ...settings, bubble });
    updateSettings({ bubble: patch }).catch((error) => console.error('Klipkord: could not save bubble settings', error));
    // A recorder already holding the streams moves the bubble too.
    void command({ type: 'recorder/bubble', bubble });
  }

  if (!settings || !capture) return <main className="screen" style={{ background: '#F6F6F7' }} />;
  const soundLabel = capture.mode === 'screen' ? 'Include computer sound' : 'Include tab sound';
  const bars = meterBars(meter.level);

  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114', minHeight: '100vh' }}>
      <Brand
        padding="16px 16px 0 24px"
        right={<>
          <button type="button" aria-label="Library" onClick={() => navigate('Library')} style={ICON_LINK}><Icon>{ICONS.library}</Icon></button>
          <button type="button" aria-label="Settings" onClick={() => navigate('Settings')} style={ICON_LINK}><Icon>{ICONS.settings}</Icon></button>
        </>}
      />

      {(capture.mic && meter.blocked) || (capture.camera && camera.busy) || (capture.mode === 'window' && capture.sound) ? (
        <div style={{ margin: '12px 24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {capture.mic && meter.blocked && (
            <StateCard icon={ICONS.micOff} tone="red" title="Klipkord can’t use your microphone"
              body="Chrome has blocked it for Klipkord. You can still record your screen without your voice."
              action="Allow microphone" onAction={() => navigate('Permissions')} />
          )}
          {capture.camera && camera.busy && (
            <StateCard icon={ICONS.camera} tone="amber" title="Another app is using your camera"
              body="Close it there and the bubble comes back, or record without it."
              action="Record without camera" onAction={() => setCapture({ camera: false })} />
          )}
          {capture.mode === 'window' && capture.sound && (
            <StateCard icon={ICONS.noSound} tone="grey" title="A single window can’t include its sound"
              body="Your voice is still recorded. Pick a tab or your whole screen to include computer sound."
              action="Pick again" onAction={() => setCapture({ mode: 'tab' })} />
          )}
        </div>
      ) : null}

      <BubblePreview bubble={settings.bubble} camera={capture.camera && !camera.busy} stream={camera.stream} />
      <BubbleControls bubble={settings.bubble} onChange={setBubble} />

      <div style={{ margin: '16px 24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#5F6168' }}>What to record</span>
        <div role="radiogroup" aria-label="What to record" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {MODES.map(({ mode, label, icon }) => {
            const on = capture.mode === mode;
            return (
              <button key={mode} type="button" role="radio" aria-checked={on} onClick={() => setCapture({ mode })}
                style={{ height: 64, borderRadius: 12, border: on ? '2px solid #C2410C' : '1px solid #E8E8EB', background: '#FFFFFF', font: 'inherit', fontSize: 13, fontWeight: on ? 600 : 500, color: on ? '#111114' : '#44464D', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer' }}>
                <Icon>{icon}</Icon>{label}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: 12, color: '#6E7079' }}>A tab gives the cleanest sound.</span>
      </div>

      <div style={{ margin: '14px 24px 0', borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column' }}>
        <div style={ROW}>
          <Icon>{ICONS.mic}</Icon>
          <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meter.name ?? 'Microphone'}</span>
            {capture.mic && !meter.blocked && (
              <span aria-label="Mic level" style={{ display: 'flex', gap: 3 }}>
                {Array.from({ length: 8 }, (_, i) => <span key={i} style={{ width: 14, height: 4, borderRadius: 2, background: i < bars ? '#15803D' : '#DCDCE0' }} />)}
              </span>
            )}
          </span>
          <Switch on={capture.mic} label="Microphone" onToggle={() => setCapture({ mic: !capture.mic })} />
        </div>
        {DIVIDER}
        <div style={ROW}>
          <Icon>{ICONS.camera}</Icon>
          <span style={{ flexGrow: 1, fontSize: 14, fontWeight: 500 }}>Camera bubble</span>
          <Switch on={capture.camera} label="Camera bubble" onToggle={() => setCapture({ camera: !capture.camera })} />
        </div>
        {DIVIDER}
        <div style={ROW}>
          <Icon>{ICONS.sound}</Icon>
          <span style={{ flexGrow: 1, fontSize: 14, fontWeight: 500 }}>{soundLabel}</span>
          <Switch on={capture.sound} label={soundLabel} onToggle={() => setCapture({ sound: !capture.sound })} />
        </div>
        {DIVIDER}
        <div style={{ ...ROW, padding: '10px 14px' }}>
          <span style={{ flexGrow: 1, fontSize: 14, fontWeight: 500 }}>Quality</span>
          <div role="radiogroup" aria-label="Quality" style={SEGMENTS}>
            {(['720p', '1080p'] as Quality[]).map((q) => (
              <button key={q} type="button" role="radio" aria-checked={capture.quality === q} onClick={() => setCapture({ quality: q })} style={segment(capture.quality === q)}>{q}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={start} disabled={recorder?.status === 'saving'}
          style={{ height: 52, border: 'none', borderRadius: 14, background: '#C2410C', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer' }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FFFFFF' }} />Start recording
        </button>
        <span style={{ textAlign: 'center', fontSize: 12, color: '#6E7079' }}>
          Or press <span style={{ fontFamily: MONO, padding: '1px 5px', borderRadius: 4, background: '#EBEBEE', color: '#44464D' }}>Alt+Shift+R</span> from any tab
        </span>
      </div>

      <div style={{ flexGrow: 1 }} />
      {last && (
        <div style={{ margin: '20px 24px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#5F6168' }}>Last recording</span>
            <button type="button" onClick={() => navigate('Library')} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, fontWeight: 500, color: '#C2410C', cursor: 'pointer' }}>See all</button>
          </div>
          <button type="button" onClick={() => navigate('Review', { recordingId: last.id })}
            style={{ padding: 10, borderRadius: 14, background: '#FFFFFF', border: '1px solid #E8E8EB', color: '#111114', font: 'inherit', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <Thumb recording={last} width={64} />
            <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{last.title}</span>
              <span style={{ fontSize: 12, color: '#6E7079' }}>{[last.summary && STYLE_NAMES[last.summary.style], dayAndTime(last.createdAt)].filter(Boolean).join(' · ')}</span>
            </span>
          </button>
        </div>
      )}
    </main>
  );
}

/** Video thumbnail (when one exists) with the duration in the corner. */
export function Thumb({ recording, width }: { recording: Recording; width: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!recording.thumbnail) return;
    const u = URL.createObjectURL(recording.thumbnail);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [recording.thumbnail]);
  return (
    <span style={{ width, aspectRatio: '16 / 9', borderRadius: width > 100 ? 10 : 8, background: url ? `#26262B center / cover url(${url})` : '#26262B', position: 'relative', flexShrink: 0 }}>
      <span style={{ position: 'absolute', right: 4, bottom: 4, padding: '1px 4px', borderRadius: 4, background: 'rgba(17,17,20,0.8)', color: '#FFFFFF', fontFamily: MONO, fontSize: width > 100 ? 10 : 9 }}>{shortClock(recording.duration)}</span>
    </span>
  );
}
