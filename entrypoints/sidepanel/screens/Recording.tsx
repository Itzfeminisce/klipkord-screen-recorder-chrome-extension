import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from '../router';
import { LiveBubblePreview } from '../components/BubblePreview';
import { command, useNow, useRecorder } from '@/lib/capture';
import { clockElapsed, type RecorderState } from '@/lib/recorder';
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

const CONTROL: CSSProperties = { height: 56, border: 'none', borderRadius: 14, background: '#1F1F24', color: '#F6F6F7', font: 'inherit', fontSize: 12, fontWeight: 500, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer' };

export default function Recording() {
  const state = useFollowRecorder('recording');
  const now = useNow();
  const [busy, setBusy] = useState(false);

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

      {/* T5 slot: "Mark this moment" marker buttons. */}
      <div data-slot="markers" />

      {/* T6 slot: live transcript. */}
      <div data-slot="live-transcript" style={{ flexGrow: 1 }} />

      {/* T5 slot: "Type a note at <time>" + "Add". */}
      <div data-slot="timed-note" style={{ paddingBottom: 24 }} />
    </main>
  );
}
