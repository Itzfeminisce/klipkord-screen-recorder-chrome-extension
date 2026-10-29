import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Spinner } from '../components';
import { useRouter } from '../router';
import { checkKeys, loadKeyStatus, saveKeyStatus } from '@/lib/connect';
import { isKeyName } from '@/lib/keyDetect';
import { loadKeys } from '@/lib/keys';
import { updateSettings } from '@/lib/settings';
import { detectMachine, notesEngineFor, setupChoice, type MachineCheck, type RowStatus, type SetupState } from '@/lib/setup';
import type { AiMode } from '@/lib/types';

// ---- Shared by the onboarding and key screens (inline styles follow the frames) ----

export const MONO = 'var(--mono)';
export const CARD: CSSProperties = { borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB' };
export const PAGE: CSSProperties = { background: '#F6F6F7', color: '#111114' };
const BLACK_BUTTON: CSSProperties = {
  width: '100%', height: 48, borderRadius: 12, border: 'none', background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 15,
  fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
};

export function BackArrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
  );
}

/** Back arrow on the left, a mono label (step count or "Faster with Groq") on the right. */
export function Head({ right, onBack }: { right: string; onBack: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 0' }}>
      <button type="button" aria-label="Back" onClick={onBack} style={{ width: 36, height: 36, marginLeft: -8, borderRadius: 10, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111114', cursor: 'pointer' }}>
        <BackArrow />
      </button>
      <span style={{ fontFamily: MONO, fontSize: 11, color: '#6E7079' }}>{right}</span>
    </div>
  );
}

export function Heading({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ padding: '12px 24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</h1>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#5F6168' }}>{text}</p>
    </div>
  );
}

export function PrimaryButton({ children, ...rest }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" {...rest} style={{ ...BLACK_BUTTON, ...(rest.disabled ? { background: '#DCDCE0', color: '#5F6168', cursor: 'not-allowed' } : {}) }}>{children}</button>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', fontWeight: 500 }}>{children}</a>;
}

export function PenvTile({ size = 40 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: size === 40 ? 12 : 9, background: '#111114', color: '#FFFFFF', fontFamily: MONO, fontSize: size === 40 ? 13 : 11, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>pv</span>
  );
}

/** A message card from StatesSetup: a round mark, a title, one line and one action. */
export function StateBanner({ mark, tone = 'info', title, body, action }: { mark: ReactNode; tone?: 'info' | 'error' | 'warn'; title: string; body: string; action: ReactNode }) {
  const tint = tone === 'error' ? { background: '#FEF2F2', color: '#B91C1C' } : tone === 'warn' ? { background: '#FFF7E6', color: '#92400E' } : { background: '#F1F1F3', color: '#44464D' };
  return (
    <div role="alert" style={{ ...CARD, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <span style={{ width: 32, height: 32, borderRadius: '50%', ...tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: MONO, fontSize: 11 }}>{mark}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>{body}</span>
        </span>
      </div>
      {action}
    </div>
  );
}

const ACTION: CSSProperties = {
  alignSelf: 'flex-start', height: 36, padding: '0 14px', border: 'none', borderRadius: 10, background: '#111114', color: '#FFFFFF',
  font: 'inherit', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', cursor: 'pointer',
};

export function BannerAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} style={ACTION}>{children}</button>;
}

export const InfoMark = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></svg>
);

export const Check = ({ color = '#15803D' }: { color?: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
);

// ---- Setup ----

const OPTION: CSSProperties = { padding: 16, borderRadius: 16, background: '#FFFFFF', color: '#111114', font: 'inherit', textAlign: 'left', display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' };

function Option({ checked, recommended, title, text, onPick }: { checked: boolean; recommended: boolean; title: string; text: string; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onPick} style={{ ...OPTION, border: checked ? '2px solid #C2410C' : '1px solid #E8E8EB' }}>
      <span style={{ width: 20, height: 20, borderRadius: '50%', border: checked ? '6px solid #C2410C' : '2px solid #9A9BA3', boxSizing: 'border-box', flexShrink: 0, marginTop: 1 }} />
      <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
          {recommended && <span style={{ padding: '2px 8px', borderRadius: 999, background: '#FFF1EA', color: '#9A3412', fontSize: 11, fontWeight: 600 }}>Recommended</span>}
        </span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>{text}</span>
      </span>
    </button>
  );
}

const PENDING: MachineCheck = { webgpu: null, builtinAi: null };

export default function Setup() {
  const { navigate, back, canGoBack, replace } = useRouter();
  const [check, setCheck] = useState<MachineCheck>(PENDING);
  const [picked, setPicked] = useState<AiMode | null>(null);
  

  useEffect(() => {
    detectMachine().then(setCheck).catch((error) => {
      console.error('Klipkord: could not check this computer', error);
      setCheck({ webgpu: false, builtinAi: false });
    });
  }, []);

  const running = check.webgpu === null;
  const choice = setupChoice(check);
  const selected = picked ?? choice.ai;
  const lines = [
    check.webgpu === true && 'Graphics card can run speech-to-text',
    check.builtinAi === true && 'Chrome’s built-in AI can write notes',
  ].filter((l): l is string => !!l);

  async function choose(ai: AiMode, next: 'ModelDownload' | 'PenvConnect') {
    try {
      // Cloud is saved once a key works; local is confirmed here.
      await updateSettings({ notesEngine: notesEngineFor(ai, check.builtinAi), ...(ai === 'local' ? { ai, onboarded: true } : {}) });
    } catch (error) {
      console.error('Klipkord: could not save the AI choice', error);
    }
    navigate(next);
  }

  const banner = (state: SetupState): ReactNode =>
    state === 'no-built-in-ai' ? (
      <StateBanner key={state} mark={InfoMark} title="Chrome’s built-in AI isn’t available here" body="Transcripts still run on this computer. For notes, use Ollama or Groq."
        action={<BannerAction onClick={() => navigate('Settings')}>Choose how to write notes</BannerAction>} />
    ) : (
      <StateBanner key={state} mark={InfoMark} title="Transcripts will be slow on this computer" body="They’ll take longer than the recording itself. Groq does it in seconds."
        action={<BannerAction onClick={() => { setPicked('cloud'); void choose('cloud', 'PenvConnect'); }}>Use Groq instead</BannerAction>} />
    );

  return (
    <main className="screen" style={PAGE}>
      <Head right="Step 2 of 2" onBack={() => (canGoBack ? back() : replace('Permissions'))} />
      <Heading title="Where should the AI run?" text="The AI turns your voice into a transcript and notes. You can change this later in Settings." />

      {(running || lines.length > 0) && (
        <div style={{ ...CARD, margin: '18px 24px 0', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#6E7079' }}>We checked this computer</span>
          {running && <Spinner label="Checking this computer" size={16} />}
          {lines.map((line) => (
            <span key={line} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}><Check />{line}</span>
          ))}
        </div>
      )}

      {!running && choice.states.length > 0 && (
        <div style={{ margin: '12px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>{choice.states.map(banner)}</div>
      )}

      <div role="radiogroup" aria-label="Where AI runs" style={{ margin: '12px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Option checked={selected === 'local'} recommended={choice.ai === 'local'} title="On this computer" text="Free and private. Works offline. Needs a one-time download of about 250 MB." onPick={() => setPicked('local')} />
        <Option checked={selected === 'cloud'} recommended={choice.ai === 'cloud'} title="Faster with Groq" text="Quicker, sharper notes. Your voice and transcript go to Groq, never your video. Needs a free Groq key." onPick={() => setPicked('cloud')} />
      </div>

      <p style={{ margin: '14px 24px 0', fontSize: 12, lineHeight: 1.5, color: '#6E7079' }}>Already run Ollama? You can use it for notes in Settings.</p>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '20px 24px 24px' }}>
        <PrimaryButton disabled={running} onClick={() => void choose(selected, selected === 'local' ? 'ModelDownload' : 'PenvConnect')}>Continue</PrimaryButton>
      </div>
    </main>
  );
}

/** Usable key names held in memory and the last check of each. Unchecked keys are checked on load. */
export function useKeyState() {
  const [loaded, setLoaded] = useState<string[]>([]);
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    try {
      const keys = await loadKeys();
      const names = Object.keys(keys).filter(isKeyName).sort();
      const saved = await loadKeyStatus();
      setLoaded(names);
      setStatus({ ...Object.fromEntries(names.map((n) => [n, 'checking' as const])), ...saved });
      setReady(true);
      const unchecked = Object.fromEntries(Object.entries(keys).filter(([n]) => isKeyName(n) && !saved[n]));
      if (Object.keys(unchecked).length > 0) {
        const results = await checkKeys(unchecked);
        await saveKeyStatus({ ...saved, ...results });
        setStatus((s) => ({ ...s, ...results }));
      }
    } catch (error) {
      console.error('Klipkord: could not read the keys in memory', error);
      setReady(true);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { loaded, status, ready, reload };
}

export const STATUS_TEXT: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 };
