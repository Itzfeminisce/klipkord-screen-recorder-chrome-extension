import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from '../router';
import { LiveBubblePreview } from '../components/BubblePreview';
import { command, useNow, useRecorder } from '@/lib/capture';
import type { Marker, MarkerKind, Segment } from '@/lib/types';
import { getRecording } from '@/lib/db';
import { loadKeys } from '@/lib/keys';
import { PROVIDERS } from '@/lib/llm';
import { onMessage, send } from '@/lib/messages';
import type { TranscriptStatus } from '@/lib/transcribe/queue';
import { clockElapsed, type RecorderState } from '@/lib/recorder';
import { MARKER_KINDS, MARKER_LABEL, addMarker, addNote, markerTime, noteStart } from '@/lib/markers';
import { isDiskLow, minutesLeft } from '@/lib/storageMath';
import { formatBytes, formatClock } from '@/lib/time';
import { ICONS, Icon, MODE_LABEL, MONO, StateCard } from './Home';

const MIC_SETTINGS_URL = 'chrome://settings/content/microphone';

/** Follows the offscreen recorder: paused, finished or gone moves the panel to the matching screen. */
export function useFollowRecorder(here: RecorderState['status']): RecorderState | null {
  const { replace } = useRouter();
  const state = useRecorder();
  useEffect(() => {
    if (!state || state.status === here || state.status === 'saving') return;
    if (state.status === 'recording') replace('Recording', { recordingId: state.recordingId });
    else if (state.status === 'paused') replace('Paused', { recordingId: state.recordingId });
    else if (state.status === 'done' && state.recordingId) replace('Processing', { recordingId: state.recordingId });
    else if (state.status === 'idle') replace('Home');
  }, [state, here, replace]);
  return state;
}

export function LiveHeader({ state, paused }: { state: RecorderState; paused?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 24px 0' }}>
      {paused ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: '#FBBF24', color: '#111114', fontSize: 12, fontWeight: 600 }}><Icon size={12}>{ICONS.pause}</Icon>Paused</span>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: '#DC2626', color: '#FFFFFF', fontSize: 12, fontWeight: 600 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FFFFFF' }} />Recording</span>
      )}
      <span style={{ flexGrow: 1, fontSize: 13, color: '#B4B5BC' }}>{state.mode ? MODE_LABEL[state.mode] : ''}</span>
    </div>
  );
}

const T_ICONS = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  cloud: <path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z" />,
};

/** The offscreen transcript's status for this recording, live. */
export function useTranscript(recordingId: string | undefined): TranscriptStatus | null {
  const [status, setStatus] = useState<TranscriptStatus | null>(null);
  useEffect(() => {
    if (!recordingId) return;
    let alive = true;
    const take = (s: TranscriptStatus | undefined) => alive && s?.recordingId === recordingId && setStatus(s);
    const off = onMessage((msg) => {
      if (msg.type === 'transcript/status') take(msg.status);
      return undefined;
    });
    void send<TranscriptStatus>({ type: 'transcript/get' }).then(take);
    return () => {
      alive = false;
      off();
    };
  }, [recordingId]);
  return status;
}

/** Markers saved on this recording, refreshed every couple of seconds. */
function useMarkers(recordingId: string | undefined): Marker[] {
  const [markers, setMarkers] = useState<Marker[]>([]);
  useEffect(() => {
    if (!recordingId) return;
    const read = () => getRecording(recordingId).then((r) => r && setMarkers(r.markers), (error) => console.error('Klipkord: could not read markers', error));
    void read();
    const id = setInterval(read, 2000);
    return () => clearInterval(id);
  }, [recordingId]);
  return markers;
}

type Line = { at: number; text?: string; marker?: MarkerKind };

function LiveTranscript({ status, markers }: { status: TranscriptStatus | null; markers: Marker[] }) {
  const body = useRef<HTMLDivElement>(null);
  const segments: Segment[] = status?.segments ?? [];
  const lines: Line[] = [
    ...segments.map((s) => ({ at: s.start, text: s.text })),
    ...markers.map((m) => ({ at: m.at, marker: m.kind })),
  ].sort((a, b) => a.at - b.at);
  const lastText = segments.length ? segments[segments.length - 1]! : null;
  const where = status?.engine === 'groq' ? 'Groq' : 'On this computer';
  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [lines.length]);
  return (
    <div style={{ margin: '18px 24px 0', flexGrow: 1, minHeight: 0, borderRadius: 16, background: '#1A1A1F', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #26262B' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Live transcript</span>
        <span style={{ fontSize: 12, color: '#9A9BA3' }}>{where} · about 10 s behind</span>
      </div>
      <div ref={body} aria-live="polite" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, lineHeight: 1.5, overflowY: 'auto', maxHeight: 240 }}>
        {lines.map((line, i) => line.marker ? (
          <div key={`m${i}`} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: '#9A9BA3' }}>{formatClock(line.at)}</span>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: '#3B1D12', color: '#FDBA8C', fontSize: 12, fontWeight: 600 }}>{MARKER_LABEL[line.marker]}</span>
          </div>
        ) : (
          <div key={`s${i}`} style={{ display: 'flex', gap: 10 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: '#9A9BA3', paddingTop: 2 }}>{formatClock(line.at)}</span>
            <span style={{ color: lastText && line.at === lastText.start ? '#9A9BA3' : '#D4D5DA' }}>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SHORTCUTS = [['Stop', 'Alt+Shift+R'], ['Pause or resume', 'Alt+Shift+P'], ['Mark a moment', 'Alt+Shift+M']];

const CONTROL: CSSProperties = { height: 56, border: 'none', borderRadius: 14, background: '#1F1F24', color: '#F6F6F7', font: 'inherit', fontSize: 12, fontWeight: 500, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer' };

export default function Recording() {
  const state = useFollowRecorder('recording');
  const { navigate } = useRouter();
  const transcript = useTranscript(state?.recordingId);
  const markers = useMarkers(state?.recordingId);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [typedAt, setTypedAt] = useState<number | null>(null);

  if (!state || state.status === 'idle') return <main className="screen screen-dark" style={{ minHeight: '100vh' }} />;
  const elapsed = clockElapsed(state.clock, now);
  const saving = busy || state.status === 'saving';
  const disk = state.disk;
  const left = disk ? minutesLeft(disk.free, disk.bytesPerSecond) : null;

  async function act(msg: Parameters<typeof command>[0]) {
    setBusy(true);
    const reply = await command(msg);
    if (!reply.ok) console.error('Klipkord: could not control the recording', reply.error);
    setBusy(false);
  }

  const recordingId = state.recordingId;
  async function mark(kind: MarkerKind) {
    const at = state ? markerTime(state, Date.now()) : null;
    if (at === null || !recordingId) return;
    if (!(await addMarker(recordingId, at, kind))) console.error('Klipkord: could not save the marker', kind);
  }
  function type(value: string) {
    setText(value);
    setTypedAt(noteStart(typedAt, value, elapsed));
  }
  async function submitNote() {
    if (!recordingId || !text.trim()) return;
    if (!(await addNote(recordingId, typedAt ?? elapsed, text))) return void console.error('Klipkord: could not save the note', recordingId);
    setText('');
    setTypedAt(null);
  }
  const noteTime = formatClock(typedAt ?? elapsed);

  // "Use Groq for this one": needs Groq's host permission and a key; without a key, connect one first.
  async function useGroq() {
    const granted = await browser.permissions.request({ origins: ['https://api.groq.com/*'] }).catch(() => false);
    if (!granted) return;
    const keys = await loadKeys().catch(() => ({} as Record<string, string>));
    if (!keys[PROVIDERS.groq.keyName]) return navigate('PenvConnect');
    await send({ type: 'transcript/use-groq' });
  }
  const behind = Boolean(transcript?.behind);
  const cloudDown = Boolean(transcript?.cloudDown);

  return (
    <main className="screen screen-dark" style={{ minHeight: '100vh', background: '#111114', color: '#F6F6F7' }}>
      <LiveHeader state={state} />

      {(state.silentMic || (disk && isDiskLow(disk.free)) || behind || cloudDown) && (
        <div style={{ margin: '14px 24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {disk && isDiskLow(disk.free) && (
            <StateCard dark icon={ICONS.warn} tone="dark-amber" title={`Only ${formatBytes(disk.free)} left on this computer`}
              body={`${left !== null ? `That’s about ${left} more minutes. ` : ''}Klipkord will stop and save on its own before space runs out.`}
              action="Stop and save" onAction={() => void act({ type: 'recorder/stop' })} />
          )}
          {state.silentMic && (
            <StateCard dark icon={ICONS.mic} tone="dark-amber" title="We can’t hear you"
              body="Your mic has been silent for 30 seconds. The video is still recording."
              action="Check microphone" onAction={() => void browser.tabs.create({ url: MIC_SETTINGS_URL })} />
          )}
          {behind && !cloudDown && (
            <StateCard dark icon={T_ICONS.clock} tone="dark-amber" title="The transcript is running behind"
              body="Your computer is busy, so Klipkord will finish it after you stop. The recording is fine."
              action="Use Groq for this one" onAction={() => void useGroq()} />
          )}
          {cloudDown && (
            <StateCard dark icon={T_ICONS.cloud} tone="dark-amber" title="Groq isn’t responding"
              body="Klipkord switched to on-device AI for this recording, so your transcript keeps going."
              action="Open Settings" onAction={() => navigate('Settings')} />
          )}
        </div>
      )}

      <div style={{ padding: '14px 24px 0', display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontFamily: MONO, fontSize: 44, fontWeight: 500, letterSpacing: '-0.02em' }}>{formatClock(elapsed)}</span>
        <LiveBubblePreview />
      </div>

      <div style={{ padding: '16px 24px 0', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <button type="button" aria-pressed={state.muted} disabled={!state.mic || saving} onClick={() => void act({ type: 'recorder/mute', muted: !state.muted })}
          style={{ ...CONTROL, ...(state.muted ? { background: '#F6F6F7', color: '#111114' } : {}), opacity: state.mic ? 1 : 0.5 }}>
          <Icon>{state.muted ? ICONS.micOff : ICONS.mic}</Icon>Mute
        </button>
        <button type="button" disabled={saving} onClick={() => void act({ type: 'recorder/pause' })} style={CONTROL}>
          <Icon>{ICONS.pause}</Icon>Pause
        </button>
        <button type="button" disabled={saving} onClick={() => void act({ type: 'recorder/stop' })} style={{ ...CONTROL, background: '#F6F6F7', color: '#111114', fontWeight: 600 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: '#DC2626' }} />Stop
        </button>
      </div>

      <div data-slot="markers" style={{ padding: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#B4B5BC' }}>Mark this moment</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
          {MARKER_KINDS.map((kind) => (
            <button key={kind} type="button" onClick={() => void mark(kind)}
              style={{ height: 44, border: '1px solid #2C2C32', borderRadius: 12, background: 'transparent', color: '#F6F6F7', font: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>{MARKER_LABEL[kind]}</button>
          ))}
        </div>
      </div>

      <LiveTranscript status={transcript} markers={markers} />
      <div style={{ flexGrow: 1, minHeight: 12 }} />

      <div style={{ margin: '0 24px', padding: 12, borderRadius: 12, background: '#1A1A1F', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#B4B5BC' }}>
        <span style={{ fontWeight: 600, color: '#F6F6F7' }}>Shortcuts</span>
        {SHORTCUTS.map(([name, keys]) => (
          <span key={keys} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{name}</span><span style={{ fontFamily: MONO }}>{keys}</span></span>
        ))}
      </div>

      <form data-slot="timed-note" onSubmit={(e) => { e.preventDefault(); void submitNote(); }} style={{ padding: '12px 24px 24px', display: 'flex', gap: 8 }}>
        <label style={{ flexGrow: 1, display: 'flex' }}>
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Note at {noteTime}</span>
          <input type="text" value={text} onChange={(e) => type(e.target.value)} placeholder={`Type a note at ${noteTime}`}
            style={{ width: '100%', height: 44, padding: '0 12px', borderRadius: 12, border: '1px solid #2C2C32', background: '#1A1A1F', color: '#F6F6F7', font: 'inherit', fontSize: 13, boxSizing: 'border-box' }} />
        </label>
        <button type="submit" disabled={!text.trim()} style={{ height: 44, padding: '0 16px', border: 'none', borderRadius: 12, background: '#2C2C32', color: '#F6F6F7', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: text.trim() ? 1 : 0.5 }}>Add</button>
      </form>
    </main>
  );
}
