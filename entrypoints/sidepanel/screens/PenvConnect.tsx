import { useEffect, useState } from 'react';
import { Spinner } from '../components';
import { useRouter } from '../router';
import { checkKeys, requestHosts, saveKeyStatus } from '@/lib/connect';
import { loadKeys } from '@/lib/keys';
import { connectKeyNames, connectPenvApp, loadPenvAppKeys, PenvAppError, wasDisconnected } from '@/lib/penvApp';
import { updateSettings } from '@/lib/settings';
import { canStart, cloudSettings, NEEDED_KEYS, PENV_CLOUD_URL } from '@/lib/setup';
import { BannerAction, CARD, ExternalLink, Head, Heading, PAGE, PenvTile, PrimaryButton, StateBanner, useKeyState } from './Setup';

/** Segmented switch between Penv Cloud and pasting a key. */
export function SourceSwitch({ value, onPick }: { value: 'penv' | 'paste'; onPick: (v: 'penv' | 'paste') => void }) {
  const item = (v: 'penv' | 'paste', label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === v}
      onClick={() => value !== v && onPick(v)}
      style={{ height: 32, borderRadius: 7, border: 'none', font: 'inherit', fontSize: 12, cursor: 'pointer', ...(value === v ? { background: '#FFFFFF', fontWeight: 600, color: '#111114', boxShadow: '0 1px 2px rgba(16,16,20,0.08)' } : { background: 'transparent', fontWeight: 500, color: '#5F6168' }) }}
    >
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Where keys come from" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4, padding: 4, borderRadius: 10, background: '#F1F1F3' }}>
      {item('penv', 'Use Penv Cloud')}
      {item('paste', 'Paste a key')}
    </div>
  );
}

export default function PenvConnect() {
  const { navigate, replace, back, canGoBack } = useRouter();
  const keys = useKeyState();
  const [busy, setBusy] = useState(false);
  const [didntConnect, setDidntConnect] = useState(false);
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    wasDisconnected().then(setDisconnected).catch(() => undefined);
  }, []);

  async function connect() {
    setDidntConnect(false);
    setBusy(true);
    // First await keeps the click's user gesture for Chrome's permission prompt.
    await requestHosts(['https://penv.cloud/*', 'https://api.groq.com/*']);
    try {
      const conn = await connectPenvApp({ keys: connectKeyNames(NEEDED_KEYS) });
      await updateSettings({ keySource: 'penv-app', penvApp: conn });
      setDisconnected(false);
      await loadPenvAppKeys(conn);
      await saveKeyStatus(await checkKeys(await loadKeys()));
      replace('PenvConnected');
    } catch (error) {
      if (error instanceof PenvAppError && error.code === 'disconnected') setDisconnected(true);
      else setDidntConnect(true);
      console.error('Klipkord: could not connect Penv Cloud', error instanceof Error ? error.name : 'error');
      setBusy(false);
    }
  }

  async function start() {
    try {
      await updateSettings({ ...cloudSettings(keys.loaded, keys.status), onboarded: true });
    } catch (error) {
      console.error('Klipkord: could not save the AI choice', error);
    }
    replace('Home');
  }

  const ready = canStart(keys.loaded, keys.status);

  return (
    <main className="screen" style={PAGE}>
      <Head right="Faster with Groq" onBack={() => (canGoBack ? back() : replace('Setup'))} />
      <Heading title="Add your Groq key" text="Klipkord keeps keys only until Chrome closes, and never shows them again." />

      <div style={{ ...CARD, margin: '18px 24px 0', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SourceSwitch value="penv" onPick={() => navigate('PasteKey')} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <PenvTile />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Your keys, in one safe place</span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>
              <ExternalLink href={PENV_CLOUD_URL}>Penv Cloud</ExternalLink> stores your API keys. Connect once and Klipkord loads the ones you choose each time you open it.
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => void connect()}
          disabled={busy}
          style={{ height: 48, border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}
        >
          {busy && <Spinner label="Connecting" size={16} />}
          Connect Penv Cloud
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
        </button>
        <ul style={{ listStyle: 'none', margin: 0, padding: 12, borderRadius: 12, background: '#F6F6F7', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, lineHeight: 1.45, color: '#44464D' }}>
          <li>Penv Cloud opens in a new window. Sign in and choose which keys Klipkord can read.</li>
          <li>Klipkord can only read the keys you choose. It can’t change anything.</li>
          <li>Disconnect any time, here or on penv.cloud.</li>
        </ul>
        <span style={{ fontSize: 12, color: '#6E7079' }}>New to Penv Cloud? <ExternalLink href={PENV_CLOUD_URL}>See how it works</ExternalLink></span>
      </div>

      {(didntConnect || disconnected) && (
        <div style={{ margin: '12px 24px 0' }}>
          {disconnected ? (
            <StateBanner mark="pv" tone="error" title="Penv Cloud is disconnected" body="Klipkord is using on-device AI until you connect again." action={<BannerAction onClick={() => void connect()}>Connect again</BannerAction>} />
          ) : (
            <StateBanner mark="pv" tone="error" title="Penv Cloud didn’t connect" body="The window closed before you approved. Nothing was shared." action={<BannerAction onClick={() => void connect()}>Try again</BannerAction>} />
          )}
        </div>
      )}

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PrimaryButton disabled={!ready} onClick={() => void start()}>Start recording</PrimaryButton>
        {!ready && <span style={{ textAlign: 'center', fontSize: 12, color: '#6E7079' }}>Connect Penv Cloud or paste a key to continue.</span>}
      </div>
    </main>
  );
}
