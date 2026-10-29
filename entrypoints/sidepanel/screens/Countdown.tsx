import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '../router';
import { getSettings } from '@/lib/settings';
import { captureSize, command, getRecorderState, hasRecorder, prepareRecorder, sourceLabel, useRecordedTab } from '@/lib/capture';
import type { Settings } from '@/lib/types';
import { Brand, ICONS, MODE_LABEL, MONO, StateCard } from './Home';

type Phase = 'picking' | 'counting' | 'cancelled' | 'starting';

const DARK_BUTTON = { height: 48, border: 'none', borderRadius: 12, font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' } as const;

export default function Countdown() {
  const { replace } = useRouter();
  const [phase, setPhase] = useState<Phase>('picking');
  const [n, setN] = useState(3);
  const [capture, setCapture] = useState<Settings['capture'] | null>(null);
  const picking = useRef(false);
  const tab = useRecordedTab();

  const pick = useCallback(async () => {
    if (picking.current) return;
    picking.current = true;
    setPhase('picking');
    setN(3);
    try {
      const settings = await getSettings();
      setCapture(settings.capture);
      // Restart from Paused keeps the picked source: count down again on the same streams.
      if ((await getRecorderState()).status === 'armed' && (await hasRecorder())) return setPhase('counting');
      const { mode, mic, sound, quality, camera } = settings.capture;
      const dpr = window.devicePixelRatio || 1;
      const size = captureSize(quality, screen.width * dpr, screen.height * dpr);
      // The count starts only once a source is picked and the recorder holds it.
      const reply = await prepareRecorder({ mode, mic, sound, quality, ...size, camera, bubble: settings.bubble });
      if (reply.cancelled) return setPhase('cancelled');
      if (!reply.ok) throw new Error(reply.error);
      setPhase('counting');
    } catch (error) {
      // No frame for a failed start: back to Home, said in the console.
      console.error('Klipkord: could not start recording', error);
      replace('Home');
    } finally {
      picking.current = false;
    }
  }, [replace]);

  useEffect(() => {
    void pick();
  }, [pick]);

  const begin = useCallback(async () => {
    setPhase('starting');
    const reply = await command({ type: 'recorder/begin' });
    if (reply.ok) replace('Recording');
    else {
      console.error('Klipkord: could not start recording', reply.error);
      replace('Home');
    }
  }, [replace]);

  useEffect(() => {
    if (phase !== 'counting') return;
    if (n <= 0) return void begin();
    const id = setTimeout(() => setN((x) => x - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, n, begin]);

  async function cancel() {
    setPhase('starting');
    await command({ type: 'recorder/cancel' });
    replace('Home');
  }

  const shown = Math.max(1, n);
  const chips = capture
    ? [capture.mic && 'Mic on', capture.camera && 'Camera on', capture.sound && capture.mode === 'tab' && 'Tab sound on', capture.sound && capture.mode === 'screen' && 'Computer sound on'].filter(Boolean)
    : [];

  return (
    <main className="screen screen-dark" style={{ minHeight: '100vh', background: '#111114', color: '#F6F6F7' }}>
      <Brand />
      {phase === 'cancelled' && (
        <div style={{ margin: '16px 24px 0' }}>
          <StateCard dark icon={ICONS.screen} tone="dark-grey" title="Nothing was picked"
            body="Recording didn’t start. Choose a tab, a window or your screen to begin."
            action="Try again" onAction={() => void pick()} />
        </div>
      )}

      {phase === 'cancelled' && <div style={{ flexGrow: 1 }} />}
      {phase !== 'picking' && phase !== 'cancelled' && (
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28, padding: '0 24px' }}>
        <div style={{ width: 180, height: 180, borderRadius: '50%', border: '6px solid #2C2C32', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
          <span style={{ position: 'absolute', inset: -6, borderRadius: '50%', border: '6px solid transparent', borderTopColor: '#C2410C', borderRightColor: phase === 'counting' && shown <= 2 ? '#C2410C' : 'transparent', borderBottomColor: phase === 'counting' && shown <= 1 ? '#C2410C' : 'transparent' }} />
          <span style={{ fontFamily: MONO, fontSize: 88, fontWeight: 500, lineHeight: 1 }} aria-live="polite">{shown}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>Recording starts in {shown}</h1>
          {capture && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#B4B5BC' }}>{sourceLabel(capture.mode, MODE_LABEL[capture.mode], tab)}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {chips.map((chip) => (
            <span key={String(chip)} style={{ padding: '6px 10px', borderRadius: 999, background: '#1F1F24', fontSize: 12, color: '#D4D5DA' }}>{chip}</span>
          ))}
        </div>
      </div>
      )}

      {phase !== 'picking' && (<>
      <div style={{ margin: '0 24px', padding: '12px 14px', borderRadius: 12, background: '#1F1F24', fontSize: 13, lineHeight: 1.5, color: '#D4D5DA' }}>
        Tip: press <span style={{ fontFamily: MONO, padding: '1px 5px', borderRadius: 4, background: '#2C2C32', color: '#F6F6F7' }}>Alt+Shift+M</span> to mark a moment without opening the panel.
      </div>

      <div style={{ padding: '16px 24px 24px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <button type="button" onClick={() => void cancel()} disabled={phase === 'starting'} style={{ ...DARK_BUTTON, background: '#1F1F24', color: '#F6F6F7' }}>Cancel</button>
        <button type="button" onClick={() => void begin()} disabled={phase !== 'counting'} style={{ ...DARK_BUTTON, background: '#F6F6F7', color: '#111114', opacity: phase === 'counting' ? 1 : 0.5 }}>Start now</button>
      </div>
      </>)}
    </main>
  );
}
