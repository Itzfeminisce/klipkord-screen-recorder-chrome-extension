import { useState } from 'react';
import { useRouter } from '../router';
import { command, useNow } from '@/lib/capture';
import { clockElapsed } from '@/lib/recorder';
import { formatClock } from '@/lib/time';
import { ICONS, Icon, MONO } from './Home';
import { LiveHeader, useFollowRecorder } from './Recording';

const ROW = { padding: 14, border: 'none', background: 'transparent', font: 'inherit', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer' } as const;

export default function Paused() {
  const { replace } = useRouter();
  const state = useFollowRecorder('paused');
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);

  if (!state || state.status === 'idle') return <main className="screen screen-dark" style={{ minHeight: '100vh' }} />;
  const at = formatClock(clockElapsed(state.clock, now));
  const disabled = busy || state.status === 'saving';

  async function act(msg: Parameters<typeof command>[0], then?: () => void) {
    setBusy(true);
    const reply = await command(msg);
    if (!reply.ok) console.error('Klipkord: could not control the recording', reply.error);
    setBusy(false);
    then?.();
  }

  return (
    <main className="screen screen-dark" style={{ minHeight: '100vh', background: '#111114', color: '#F6F6F7' }}>
      <LiveHeader state={state} paused />

      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 24px', textAlign: 'center' }}>
        <span style={{ fontFamily: MONO, fontSize: 64, fontWeight: 500, letterSpacing: '-0.02em', color: '#9A9BA3' }}>{at}</span>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>Recording paused</h1>
        <p style={{ margin: 0, maxWidth: 300, fontSize: 14, lineHeight: 1.5, color: '#B4B5BC' }}>Nothing is being recorded right now. Everything up to {at} is saved on this computer.</p>
      </div>

      <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" disabled={disabled} onClick={() => void act({ type: 'recorder/resume' })}
          style={{ height: 52, border: 'none', borderRadius: 14, background: '#C2410C', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer' }}>
          <Icon>{ICONS.play}</Icon>Resume
        </button>
        <button type="button" disabled={disabled} onClick={() => void act({ type: 'recorder/stop' })}
          style={{ height: 48, border: 'none', borderRadius: 12, background: '#F6F6F7', color: '#111114', font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          Finish and save
        </button>
      </div>

      <div style={{ margin: '16px 24px 24px', borderRadius: 16, background: '#1A1A1F', display: 'flex', flexDirection: 'column' }}>
        <button type="button" disabled={disabled} onClick={() => void act({ type: 'recorder/restart' }, () => replace('Countdown'))} style={{ ...ROW, color: '#F6F6F7' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Restart</span>
          <span style={{ fontSize: 12, color: '#9A9BA3' }}>Throw away this take and count down again.</span>
        </button>
        <div style={{ height: 1, background: '#26262B', margin: '0 14px' }} />
        <button type="button" disabled={disabled} onClick={() => void act({ type: 'recorder/discard' }, () => replace('Home'))} style={{ ...ROW, color: '#FCA5A5' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Discard</span>
          <span style={{ fontSize: 12, color: '#9A9BA3' }}>Delete this recording. You can’t undo this.</span>
        </button>
      </div>
    </main>
  );
}
