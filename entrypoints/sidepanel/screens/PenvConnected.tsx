import { useEffect, useState } from 'react';
import { Spinner } from '../components';
import { useRouter } from '../router';
import { forgetAll, loadKeyStatus } from '@/lib/connect';
import { jobsFor, serviceLabel, type KeyName } from '@/lib/keyDetect';
import { disconnectPenvApp } from '@/lib/penvApp';
import { getSettings, updateSettings } from '@/lib/settings';
import { canStart, cloudSettings, noUsableKeys, notesEngineFor, PENV_CLOUD_URL, STATUS_WORD } from '@/lib/setup';
import type { Settings } from '@/lib/types';
import { BannerAction, Check, CARD, ExternalLink, Head, Heading, MONO, PAGE, PenvTile, PrimaryButton, StateBanner, STATUS_TEXT, useKeyState } from './Setup';

export default function PenvConnected() {
  const { navigate, replace, back, canGoBack } = useRouter();
  const keys = useKeyState();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings).catch((error) => console.error('Klipkord: could not read settings', error));
  }, []);

  if (!settings || !keys.ready) {
    return (
      <main className="screen screen-center">
        <Spinner />
      </main>
    );
  }

  const conn = settings.penvApp;
  const ready = canStart(keys.loaded, keys.status);

  async function disconnect() {
    setBusy(true);
    try {
      // Forget locally first; the server revoke finishes in the background.
      void disconnectPenvApp().catch(() => false);
      await forgetAll();
      await updateSettings({
        keySource: null,
        penvApp: undefined,
        ai: 'local',
        notesEngine: notesEngineFor('local', null),
      });
    } catch (error) {
      console.error('Klipkord: could not disconnect Penv Cloud', error);
    }
    navigate('PenvConnect');
  }

  async function start() {
    try {
      await updateSettings({ ...cloudSettings(keys.loaded, keys.status), onboarded: true });
    } catch (error) {
      console.error('Klipkord: could not save the AI choice', error);
    }
    replace('Home');
  }

  return (
    <main className="screen" style={PAGE}>
      <Head right="Faster with Groq" onBack={() => (canGoBack ? back() : replace('Setup'))} />
      <Heading title="You’re connected" text="Klipkord will load these keys from Penv Cloud each time you open it." />

      <div style={{ ...CARD, margin: '18px 24px 0', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <PenvTile />
          <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}><ExternalLink href={PENV_CLOUD_URL}>Penv Cloud</ExternalLink></span>
            {conn && <span style={{ fontFamily: MONO, fontSize: 12, color: '#5F6168' }}>{conn.org} / {conn.project}</span>}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: '#ECFDF3', color: '#14532D', fontSize: 12, fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#15803D' }} />Connected
          </span>
        </div>
        <div style={{ height: 1, background: '#EFEFF1' }} />
        <span style={{ fontSize: 12, color: '#6E7079' }}>Keys Klipkord can read</span>
        {keys.loaded.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {keys.loaded.map((n) => {
              const st = keys.status[n] ?? 'checking';
              return (
                <li key={n} style={{ padding: 12, borderRadius: 12, background: '#F6F6F7', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500 }}>{n}</span>
                    <span style={{ fontSize: 12, color: '#5F6168' }}>{serviceLabel(n)} · {jobsFor(n as KeyName).join(' and ')}</span>
                  </span>
                  <span style={{ ...STATUS_TEXT, color: st === 'ok' ? '#15803D' : '#5F6168' }}>{st === 'ok' && <Check />}{STATUS_WORD[st]}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          <a href="#keys" onClick={(e) => { e.preventDefault(); navigate('PenvConnect'); }} style={{ textDecoration: 'none', fontWeight: 500 }}>Change which keys</a>
          <a href="#disconnect" aria-disabled={busy} onClick={(e) => { e.preventDefault(); if (!busy) void disconnect(); }} style={{ textDecoration: 'none', fontWeight: 500, color: '#44464D' }}>Disconnect</a>
        </div>
      </div>

      {noUsableKeys(keys.loaded, keys.status) && (
        <div style={{ margin: '12px 24px 0' }}>
          <StateBanner mark="pv" tone="error" title="None of the shared keys work with Klipkord" body="Share a Groq key from Penv Cloud, or add one there first."
            action={<BannerAction onClick={() => navigate('PenvConnect')}>Change which keys</BannerAction>} />
        </div>
      )}

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '20px 24px 24px' }}>
        <PrimaryButton disabled={!ready} onClick={() => void start()}>Start recording</PrimaryButton>
      </div>
    </main>
  );
}
