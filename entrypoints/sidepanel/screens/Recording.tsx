import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from '../router';
import { LiveBubblePreview } from '../components/BubblePreview';
import { command, useNow, useRecorder } from '@/lib/capture';
import type { MarkerKind } from '@/lib/types';
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

const SHORTCUTS = [['Stop', 'Alt+Shift+R'], ['Pause or resume', 'Alt+Shift+P'], ['Mark a moment', 'Alt+Shift+M']];

const CONTROL: CSSProperties = { height: 56, border: 'none', borderRadius: 14, background: '#1F1F24', color: '#F6F6F7', font: 'inherit', fontSize: 12, fontWeight: 500, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer' };

export default function Recording() {
  const state = useFollowRecorder('recording');
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

  return (
    <main className="screen screen-dark" style={{ minHeight: '100vh', background: '#111114', color: '#F6F6F7' }}>
      <LiveHeader state={state} />

      {(state.silentMic || (disk && isDiskLow(disk.free))) && (
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

      {/* T6 slot: live transcript. */}
      <div data-slot="live-transcript" style={{ flexGrow: 1 }} />

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
