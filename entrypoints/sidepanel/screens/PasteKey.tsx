import { useEffect, useRef, useState } from 'react';
import { useRouter } from '../router';
import { checkKeys, connectPaste, loadKeyStatus, requestHosts, saveKeyStatus, type KeyStatus } from '@/lib/connect';
import { serviceLabel, type KeyName } from '@/lib/keyDetect';
import { loadKeys, saveKeys } from '@/lib/keys';
import { disconnectPenvApp, invalidateAppLoads } from '@/lib/penvApp';
import { getSettings, updateSettings } from '@/lib/settings';
import { canStart, classifyPaste, cloudSettings, GROQ_KEYS_URL, KEY_PAGE, SERVICE_CHOICES, STATUS_WORD, type RowStatus } from '@/lib/setup';
import { SourceSwitch } from './PenvConnect';
import { BannerAction, Check, CARD, ExternalLink, Head, Heading, InfoMark, PAGE, PrimaryButton, StateBanner, STATUS_TEXT } from './Setup';

const CHECK_DELAY_MS = 500;

export default function PasteKey() {
  const { navigate, replace, back, canGoBack } = useRouter();
  const [value, setValue] = useState('');
  const [service, setService] = useState<KeyName | null>(null); // picked from the chips when not recognised
  const [status, setStatus] = useState<RowStatus | null>(null);
  const run = useRef(0);

  const pasted = classifyPaste(value);
  const name: KeyName | null = pasted.kind === 'known' ? pasted.name : pasted.kind === 'unknown' ? service : null;

  useEffect(() => {
    const id = ++run.current;
    if (!name || !value.trim()) {
      setStatus(null);
      return;
    }
    setStatus('checking');
    const timer = setTimeout(async () => {
      try {
        // Typing the key (or Ctrl+V) is the gesture Chrome wants for the permission prompt.
        await requestHosts([`${originOf(name)}/*`]);
        const key = value.trim();
        const result: KeyStatus = (await checkKeys({ [name]: key }))[name] ?? 'unreachable';
        if (id !== run.current) return;
        if (result === 'rejected') {
          // A refused key must not stay in memory.
          const { [name]: _gone, ...rest } = await loadKeys();
          await saveKeys(rest);
        } else {
          await connectPaste({ [name]: key });
        }
        await saveKeyStatus({ ...(await loadKeyStatus()), [name]: result });
        if (id === run.current) setStatus(result);
      } catch (error) {
        console.error('Klipkord: could not check the key', error instanceof Error ? error.name : 'error');
        if (id === run.current) setStatus('unreachable');
      }
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [name, value]);

  async function start() {
    try {
      const loaded = Object.keys(await loadKeys());
      const statuses = await loadKeyStatus();
      const s = await getSettings();
      if (s.penvApp) {
        invalidateAppLoads(); // first, so a finishing Penv Cloud load can't save keys after this
        void disconnectPenvApp(fetch, { keepKeys: true }).catch(() => false);
      }
      await updateSettings({ keySource: 'paste', penvApp: undefined, ...cloudSettings(loaded, statuses), onboarded: true });
    } catch (error) {
      console.error('Klipkord: could not save the key choice', error);
    }
    replace('Home');
  }

  const rejected = status === 'rejected' && name;
  const ready = !!name && !!status && canStart([name], { [name]: status });

  return (
    <main className="screen" style={PAGE}>
      <Head right="Faster with Groq" onBack={() => (canGoBack ? back() : replace('Setup'))} />
      <Heading title="Add your Groq key" text="Klipkord keeps keys only until Chrome closes, and never shows them again." />

      <div style={{ ...CARD, margin: '18px 24px 0', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SourceSwitch value="paste" onPick={() => navigate('PenvConnect')} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Paste your API key</span>
          <input
            type="password"
            value={value}
            onChange={(e) => { setValue(e.target.value); setService(null); }}
            aria-describedby="key-status"
            autoComplete="off"
            spellCheck={false}
            style={{ height: 44, padding: '0 12px', borderRadius: 10, border: '1px solid #DCDCE0', background: '#FFFFFF', fontFamily: 'var(--mono)', fontSize: 13, color: '#111114' }}
          />
        </label>
        <div id="key-status" aria-live="polite">
          {pasted.kind === 'known' && status && (
            <div style={{ padding: 12, borderRadius: 12, background: '#F6F6F7', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{pasted.title}</span>
                <span style={{ fontSize: 12, color: '#5F6168' }}>{pasted.jobs}</span>
              </span>
              <span style={{ ...STATUS_TEXT, color: status === 'ok' ? '#15803D' : '#5F6168' }}>{status === 'ok' && <Check />}{STATUS_WORD[status]}</span>
            </div>
          )}
        </div>
        <span style={{ fontSize: 12, lineHeight: 1.5, color: '#6E7079' }}>
          No key yet? <ExternalLink href={GROQ_KEYS_URL}>Get a free Groq key</ExternalLink>. OpenRouter, OpenAI and Anthropic keys work for notes too.
        </span>
      </div>

      {pasted.kind === 'unknown' && !service && (
        <div style={{ margin: '12px 24px 0' }}>
          <StateBanner mark={InfoMark} title="Klipkord doesn’t recognise this key" body="Check you copied all of it. Which service is it from?"
            action={
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {SERVICE_CHOICES.map((n) => (
                  <button key={n} type="button" onClick={() => setService(n)} style={{ height: 32, padding: '0 12px', border: '1px solid #E8E8EB', borderRadius: 999, background: '#FFFFFF', font: 'inherit', fontSize: 12, fontWeight: 500, color: '#111114', cursor: 'pointer' }}>{serviceLabel(n)}</button>
                ))}
              </div>
            } />
        </div>
      )}

      {rejected && (
        <div style={{ margin: '12px 24px 0' }}>
          <StateBanner mark={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></svg>} tone="error"
            title={`${serviceLabel(name)} didn’t accept this key`} body="It may have been deleted. Create a new key and paste it here."
            action={<BannerAction onClick={() => window.open(KEY_PAGE[name], '_blank', 'noreferrer')}>Create a new key</BannerAction>} />
        </div>
      )}

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '20px 24px 24px' }}>
        <PrimaryButton disabled={!ready} onClick={() => void start()}>Start recording</PrimaryButton>
      </div>
    </main>
  );
}

function originOf(name: KeyName): string {
  return { GROQ_API_KEY: 'https://api.groq.com', OPENROUTER_API_KEY: 'https://openrouter.ai', OPENAI_API_KEY: 'https://api.openai.com', ANTHROPIC_API_KEY: 'https://api.anthropic.com' }[name];
}
