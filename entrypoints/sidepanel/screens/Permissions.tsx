import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from '../router';
import { updateSettings } from '@/lib/settings';
import { onPermissionResult, openPermissionTab } from '@/lib/setup';
import { Head, Heading, PrimaryButton, PAGE } from './Setup';

const svg = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

function Row({ icon, title, text, tag, neutral }: { icon: ReactNode; title: string; text: string; tag?: string; neutral?: boolean }) {
  return (
    <div style={{ padding: 16, borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, background: neutral ? '#F1F1F3' : '#FFF1EA', color: neutral ? '#44464D' : '#9A3412', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>{text}</span>
      </span>
      {tag && <span style={{ fontSize: 12, fontWeight: 500, color: '#6E7079', paddingTop: 2 }}>{tag}</span>}
    </div>
  );
}

export default function Permissions() {
  const { navigate, back, canGoBack, replace } = useRouter();
  const [busy, setBusy] = useState(false);
  const wantCamera = useRef(true);

  // The helper tab reports once Chrome has answered; a refused mic keeps the person here.
  useEffect(
    () =>
      onPermissionResult((result) => {
        setBusy(false);
        if (!result.mic) return;
        updateSettings({ capture: { mic: true, camera: wantCamera.current && result.camera } })
          .catch((error) => console.error('Klipkord: could not save mic and camera choice', error))
          .finally(() => navigate('Setup'));
      }),
    [navigate],
  );

  async function allow(camera: boolean) {
    wantCamera.current = camera;
    setBusy(true);
    try {
      if (!camera) await updateSettings({ capture: { camera: false } });
      await openPermissionTab(camera);
    } catch (error) {
      console.error('Klipkord: could not open the permission tab', error);
      setBusy(false);
    }
  }

  return (
    <main className="screen" style={PAGE}>
      <Head right="Step 1 of 2" onBack={() => (canGoBack ? back() : replace('Main'))} />
      <Heading title="Let Klipkord hear and see you" text="Chrome will ask once. You pick what to record, screen by screen, each time you start." />

      <div style={{ margin: '22px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Row tag="Needed" title="Microphone" text="For your narration. Your voice becomes the transcript and notes."
          icon={<svg {...svg}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>} />
        <Row tag="Optional" title="Camera" text="For the round bubble with your face. Turn it off any time."
          icon={<svg {...svg}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>} />
        <Row neutral title="Your screen" text="Asked every time you record, so you choose a tab, a window or the whole screen."
          icon={<svg {...svg}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>} />
      </div>

      <div style={{ margin: '16px 24px 0', padding: '12px 14px', borderRadius: 12, background: '#ECFDF3', color: '#14532D', fontSize: 13, lineHeight: 1.45, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></svg>
        <span>Video, voice and camera stay on this computer. Klipkord has no server to send them to.</span>
      </div>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 8 }} aria-busy={busy}>
        <PrimaryButton disabled={busy} onClick={() => void allow(true)}>Allow mic and camera</PrimaryButton>
        <button type="button" disabled={busy} onClick={() => void allow(false)} style={{ height: 40, borderRadius: 12, border: 'none', background: 'transparent', color: '#44464D', font: 'inherit', fontSize: 14, fontWeight: 500, cursor: busy ? 'not-allowed' : 'pointer' }}>Allow mic only</button>
      </div>
    </main>
  );
}
