import { useEffect, useState, type ReactNode } from 'react';
import { Spinner } from '../components';
import { useRouter } from '../router';
import { putFolderHandle } from '@/lib/db';
import { wasDisconnected } from '@/lib/penvApp';
import { getSettings, onSettingsChanged, updateSettings } from '@/lib/settings';
import { notesOptions, penvRowStatus, REPO_URL, SHORTCUTS_URL, transcriptsStatus } from '@/lib/setup';
import { formatBytes } from '@/lib/time';
import { videoStore } from '@/lib/videoStore';
import type { AiMode, NotesEngine, Settings as SettingsData } from '@/lib/types';
import { BannerAction, CARD, StateBanner, useKeyState } from './Setup';

const LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'tr', 'ru', 'ar', 'hi', 'ja', 'ko', 'zh'];

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const LINK = { textDecoration: 'none', fontWeight: 500, color: '#C2410C', background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' } as const;
const SELECT = { height: 36, padding: '0 8px', borderRadius: 8, border: '1px solid #DCDCE0', background: '#FFFFFF', font: 'inherit', fontSize: 13, color: '#111114' } as const;
const ROW = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, gap: 12 } as const;
const VALUE = { fontSize: 13, color: '#5F6168' } as const;
const DIVIDER = <div style={{ height: 1, background: '#EFEFF1', margin: '0 14px' }} />;

function Section({ title, id, children, note }: { title: string; id?: string; children: ReactNode; note?: string }) {
  return (
    <section id={id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h2 style={{ margin: '0 8px', fontSize: 12, fontWeight: 600, color: '#5F6168' }}>{title}</h2>
      {children}
      {note && <span style={{ margin: '0 8px', fontSize: 12, color: '#6E7079' }}>{note}</span>}
    </section>
  );
}

export default function Settings() {
  const { navigate, replace } = useRouter();
  const keys = useKeyState();
  const [s, setS] = useState<SettingsData | null>(null);
  const [gone, setGone] = useState(false);
  const [used, setUsed] = useState<number | null>(null);

  useEffect(() => {
    getSettings().then(setS).catch((error) => console.error('Klipkord: could not read settings', error));
    wasDisconnected().then(setGone).catch(() => undefined);
    videoStore.usage().then((u) => setUsed(u.usage)).catch((error) => console.error('Klipkord: could not read storage use', error));
    return onSettingsChanged(setS);
  }, []);

  // "Where your data goes" on the welcome screen opens Settings at this section.
  useEffect(() => {
    if (s && location.hash === '#privacy') {
      document.getElementById('privacy')?.scrollIntoView();
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, [s]);

  if (!s) {
    return (
      <main className="screen screen-center">
        <Spinner />
      </main>
    );
  }

  const connected = s.keySource === 'penv-app' && !!s.penvApp && !gone;
  const penvStatus = penvRowStatus(connected && keys.loaded.length > 0, keys.loaded.length);
  const usable = keys.loaded.length > 0;

  const save = (partial: Parameters<typeof updateSettings>[0]) =>
    updateSettings(partial).then(setS).catch((error) => console.error('Klipkord: could not save settings', error));

  function pickAi(ai: AiMode) {
    if (ai === 'local') return void save({ ai, notesEngine: s!.notesEngine === 'groq' ? 'builtin' : s!.notesEngine });
    if (!usable) return navigate('PenvConnect'); // cloud turns on once a key works
    void save({ ai, notesEngine: 'groq' });
    navigate('PenvConnected');
  }

  async function changeFolder() {
    try {
      const pick = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      if (!pick) return;
      const handle = await pick({ mode: 'readwrite' });
      await putFolderHandle(handle);
      await save({ folderName: handle.name });
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') console.error('Klipkord: could not change the save folder', error);
    }
  }

  const lang = s.language;
  const codes = lang === 'auto' || LANGUAGES.includes(lang) ? LANGUAGES : [...LANGUAGES, lang];

  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 16px 0' }}>
        <button type="button" aria-label="Back to recorder" onClick={() => replace('Home')} style={{ width: 44, height: 44, borderRadius: 12, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111114', cursor: 'pointer' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>Settings</h1>
      </div>

      <div style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {gone && (
          <StateBanner mark="pv" tone="error" title="Penv Cloud is disconnected" body="Klipkord is using on-device AI until you connect again."
            action={<BannerAction onClick={() => navigate('PenvConnect')}>Connect again</BannerAction>} />
        )}

        <Section title="AI">
          <div style={{ ...CARD, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div role="radiogroup" aria-label="Where AI runs" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4, padding: 4, borderRadius: 10, background: '#F1F1F3' }}>
              {([['local', 'On this computer'], ['cloud', 'Faster with Groq']] as const).map(([ai, label]) => (
                <button key={ai} type="button" role="radio" aria-checked={s.ai === ai} onClick={() => pickAi(ai)}
                  style={{ height: 32, borderRadius: 7, border: 'none', font: 'inherit', fontSize: 12, cursor: 'pointer', ...(s.ai === ai ? { background: '#FFFFFF', fontWeight: 600, boxShadow: '0 1px 2px rgba(16,16,20,0.08)' } : { background: 'transparent', fontWeight: 500, color: '#5F6168' }) }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={ROW}><span>Transcripts</span><span style={VALUE}>{transcriptsStatus(s.ai)}</span></div>
            <label style={ROW}>
              <span>Notes</span>
              <select value={s.notesEngine} onChange={(e) => void save({ notesEngine: e.target.value as NotesEngine })} style={SELECT}>
                {notesOptions(s.ai).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <div style={ROW}>
              <span>Language</span>
              <span style={{ ...VALUE, display: 'flex', alignItems: 'center', gap: 6 }}>
                <select aria-label="Language" value={lang} onChange={(e) => void save({ language: e.target.value })} style={SELECT}>
                  <option value="auto">Detect automatically</option>
                  {codes.map((c) => <option key={c} value={c}>{languageName(c)}</option>)}
                </select>
                {lang !== 'auto' && <>· <button type="button" onClick={() => void save({ language: 'auto' })} style={LINK}>Detect automatically</button></>}
              </span>
            </div>
          </div>
        </Section>

        <Section title="Keys for cloud AI" note="Only needed when AI runs with Groq or another cloud service.">
          <div style={{ ...CARD, display: 'flex', flexDirection: 'column' }}>
            <button type="button" onClick={() => navigate(connected ? 'PenvConnected' : 'PenvConnect')} style={{ padding: '12px 14px', border: 'none', background: 'transparent', font: 'inherit', color: '#111114', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, background: '#111114', color: '#FFFFFF', fontFamily: 'var(--mono)', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>pv</span>
              <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>Penv Cloud</span>
                {penvStatus && <span style={{ fontSize: 12, color: '#15803D' }}>{penvStatus}</span>}
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#C2410C' }}>Manage</span>
            </button>
            {DIVIDER}
            <button type="button" onClick={() => navigate('PasteKey')} style={{ padding: '12px 14px', border: 'none', background: 'transparent', font: 'inherit', color: '#111114', display: 'flex', justifyContent: 'space-between', fontSize: 14, cursor: 'pointer' }}>
              <span>Paste a key instead</span><span style={{ color: '#9A9BA3' }} aria-hidden="true">›</span>
            </button>
          </div>
        </Section>

        <Section title="Recording">
          <div style={{ ...CARD, display: 'flex', flexDirection: 'column' }}>
            <div style={{ ...ROW, padding: '12px 14px' }}>
              <span>Save folder</span>
              <span style={VALUE}>{s.folderName && <>{s.folderName} · </>}<button type="button" onClick={() => void changeFolder()} style={LINK}>Change</button></span>
            </div>
            {DIVIDER}
            <div style={{ ...ROW, padding: '12px 14px' }}>
              <span>Keyboard shortcuts</span>
              <button type="button" onClick={() => void browser.tabs.create({ url: SHORTCUTS_URL })} style={{ ...LINK, fontSize: 13 }}>Change in Chrome</button>
            </div>
            {DIVIDER}
            <div style={{ ...ROW, padding: '12px 14px' }}>
              <span>Storage</span>
              <span style={VALUE}>{used !== null && <>{formatBytes(used)} · </>}<button type="button" onClick={() => navigate('Storage')} style={LINK}>Free up space</button></span>
            </div>
          </div>
        </Section>

        <Section title="Where your data goes" id="privacy">
          <div style={{ ...CARD, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, lineHeight: 1.45, color: '#44464D' }}>
            <span>Video, camera and notes never leave this computer.</span>
            <span>With Groq on, only your voice and transcript go to Groq.</span>
            <span>No account, no analytics, no tracking.</span>
          </div>
        </Section>
      </div>

      <div style={{ flexGrow: 1 }} />
      <p style={{ margin: '14px 24px 18px', fontSize: 12, color: '#6E7079' }}>
        Klipkord 1.0 · <a href={REPO_URL} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', fontWeight: 500 }}>Open source on GitHub</a>
      </p>
    </main>
  );
}
