import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from '../router';
import { BubblePreview, useCamera } from '../components/BubblePreview';
import { getSettings, onSettingsChanged } from '@/lib/settings';
import type { Settings } from '@/lib/types';
import { Brand, ICONS, Icon } from './Home';

const ICON_LINK: CSSProperties = { width: 44, height: 44, borderRadius: 12, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#44464D', cursor: 'pointer' };

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    getSettings().then(setSettings, (error) => console.error('Klipkord: could not read settings', error));
    return onSettingsChanged(setSettings);
  }, []);
  return settings;
}

/** True when cloud AI is on and the network is down: Home shows Offline instead. */
export function useOffline(): boolean {
  const online = useOnline();
  const settings = useSettings();
  return settings?.ai === 'cloud' && !online;
}

const STATUS = [['Recording', 'Works offline'], ['Transcript', 'On this computer'], ['Notes', 'On this computer']] as const;

export default function Offline() {
  const { navigate, replace } = useRouter();
  const settings = useSettings();
  const online = useOnline();
  const camera = useCamera(Boolean(settings?.capture.camera));

  // Back online (or cloud AI turned off): Home again, with Groq.
  useEffect(() => {
    if (online || (settings && settings.ai !== 'cloud')) replace('Home');
  }, [online, settings, replace]);

  return (
    <main className="screen" style={{ minHeight: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: '#F6F6F7', color: '#111114' }}>
      <Brand
        padding="16px 16px 0 24px"
        right={<>
          <button type="button" aria-label="Library" onClick={() => navigate('Library')} style={ICON_LINK}><Icon>{ICONS.library}</Icon></button>
          <button type="button" aria-label="Settings" onClick={() => navigate('Settings')} style={ICON_LINK}><Icon>{ICONS.settings}</Icon></button>
        </>}
      />

      <div role="status" style={{ margin: '12px 24px 0', padding: 14, borderRadius: 14, background: '#FFF7E6', border: '1px solid #FCD9A0', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#92400E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
          <path d="M2 8.5a15 15 0 0 1 5-3M22 8.5a15 15 0 0 0-9.5-3.5M5 12a10 10 0 0 1 4-2.5M19 12a10 10 0 0 0-2.5-1.6M8.5 15.5a5 5 0 0 1 7 0M12 19h0M3 3l18 18" />
        </svg>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#78350F' }}>You’re offline</span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: '#78350F' }}>Klipkord still records, saves and trims. Groq can’t be reached, so transcripts and notes run on this computer until you’re back online.</span>
        </span>
      </div>

      {settings && <BubblePreview bubble={settings.bubble} camera={settings.capture.camera && !camera.busy} stream={camera.stream} />}

      <div style={{ margin: '16px 24px 0', padding: '4px 14px', borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column' }}>
        {STATUS.map(([name, value], i) => (
          <div key={name}>
            {i > 0 && <div style={{ height: 1, background: '#EFEFF1' }} />}
            <div style={{ padding: '10px 0', display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span>{name}</span><span style={{ color: '#15803D', fontWeight: 500 }}>{value}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={() => navigate('Countdown')}
          style={{ height: 52, border: 'none', borderRadius: 14, background: '#C2410C', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer' }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FFFFFF' }} />Start recording
        </button>
        <span style={{ textAlign: 'center', fontSize: 12, color: '#6E7079' }}>Klipkord switches back to Groq when you’re online.</span>
      </div>
    </main>
  );
}
