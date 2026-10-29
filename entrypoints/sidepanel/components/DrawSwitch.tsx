import { useEffect, useState, type ReactNode } from 'react';
import type { RecorderState } from '@/lib/recorder';
import {
  drawAvailability, getDrawTarget, hostOf, injectOverlay, onDrawTarget, originPattern, overlayOn, removeOverlay,
} from '@/lib/draw';

const PEN = <path d="M4 20l1-4L16 5l3 3L8 19l-4 1zM14 7l3 3" />;
const GLOBE = <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>;

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  );
}

type Card = { kind: 'access'; tabId: number; url: string } | { kind: 'web-only' } | null;

const KEY = { fontFamily: "'Geist Mono', monospace", padding: '1px 5px', borderRadius: 4 } as const;

const PRIMARY = { height: 36, padding: '0 14px', border: 'none', borderRadius: 10, background: '#F6F6F7', color: '#111114', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as const;

function DrawCard({ icon, iconBg, iconFg, title, body, children }: {
  icon: ReactNode; iconBg: string; iconFg: string; title: string; body: ReactNode; children: ReactNode;
}) {
  return (
    <div role="status" style={{ padding: 14, borderRadius: 16, background: '#1A1A1F', color: '#F6F6F7', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <span style={{ width: 32, height: 32, borderRadius: '50%', background: iconBg, color: iconFg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Glyph>{icon}</Glyph></span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: '#B4B5BC' }}>{body}</span>
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>{children}</div>
    </div>
  );
}

/** The Recording panel's "Draw on the page" switch, with its draw-access and draw-web-only cards. */
export function DrawSwitch({ state, onRecordTab }: { state: RecorderState; onRecordTab: () => void }) {
  const availability = drawAvailability(state);
  const [on, setOn] = useState(false);
  const [card, setCard] = useState<Card>(null);

  useEffect(() => {
    let alive = true;
    void getDrawTarget().then(async (t) => {
      const live = Boolean(t?.on && (await overlayOn(t.tabId)));
      if (alive) setOn(live);
    }, (error) => console.error('Klipkord: could not read the drawing state', error));
    const off = onDrawTarget((t) => alive && setOn(Boolean(t?.on)));
    return () => {
      alive = false;
      off();
    };
  }, []);

  async function draw(tabId: number, url?: string) {
    await injectOverlay(tabId, url);
    setCard(null);
  }

  async function turnOn() {
    if (availability === 'web-only') return setCard({ kind: 'web-only' });
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return;
    const known = await getDrawTarget();
    const url = tab.url ?? (known?.tabId === tab.id ? known.url : undefined);
    try {
      await draw(tab.id, url);
    } catch (error) {
      // Without a grant for this site Chrome refuses the script; the card asks for one.
      if (originPattern(url)) setCard({ kind: 'access', tabId: tab.id, url: url! });
      else console.error('Klipkord: could not draw on this page', error);
    }
  }

  async function allow(tabId: number, url: string) {
    const pattern = originPattern(url);
    if (!pattern) return;
    if (await browser.permissions.request({ origins: [pattern] })) await draw(tabId, url);
  }

  async function toggle() {
    try {
      if (!on) return await turnOn();
      const t = await getDrawTarget();
      if (t) await removeOverlay(t.tabId);
      setOn(false);
    } catch (error) {
      console.error('Klipkord: could not switch drawing', error);
    }
  }

  if (availability === 'off') return null;
  const checked = on && availability === 'tab';
  return (
    <div data-slot="draw" style={{ padding: '16px 24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ minHeight: 56, padding: '0 14px', borderRadius: 14, background: '#1A1A1F', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 32, height: 32, borderRadius: 9, background: '#3B1D12', color: '#FDBA8C', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Glyph>{PEN}</Glyph></span>
        <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span id="draw-switch-label" style={{ fontSize: 13, fontWeight: 600 }}>Draw on the page</span>
          <span style={{ fontSize: 12, color: '#B4B5BC' }}>Pen, highlighter and click rings. Or press <span style={{ ...KEY, background: '#2C2C32', color: '#F6F6F7' }}>Alt+Shift+D</span> on the page.</span>
        </span>
        <button type="button" role="switch" aria-checked={checked} aria-labelledby="draw-switch-label" onClick={() => void toggle()}
          style={{ width: 44, height: 44, border: 'none', background: 'transparent', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <span style={{ width: 40, height: 24, borderRadius: 999, background: checked ? '#C2410C' : '#3A3A40', position: 'relative' }}>
            <span style={{ position: 'absolute', ...(checked ? { right: 3 } : { left: 3 }), top: 3, width: 18, height: 18, borderRadius: '50%', background: '#FFFFFF' }} />
          </span>
        </button>
      </div>
      {card?.kind === 'access' && (
        <DrawCard icon={PEN} iconBg="#3B1D12" iconFg="#FDBA8C" title="Allow drawing on this page?"
          body={<>Chrome needs your OK before Klipkord can put a pen and click rings on {hostOf(card.url)}. They only show while you record. Or press <span style={{ ...KEY, background: '#EBEBEE', color: '#44464D' }}>Alt+Shift+D</span> on the page to draw there without site access.</>}>
          <button type="button" style={PRIMARY} onClick={() => void allow(card.tabId, card.url).catch((error) => console.error('Klipkord: could not ask for drawing access', error))}>Allow on this site</button>
          <button type="button" style={{ ...PRIMARY, border: '1px solid #2C2C32', background: 'transparent', color: '#F6F6F7' }} onClick={() => setCard(null)}>Not now</button>
        </DrawCard>
      )}
      {card?.kind === 'web-only' && (
        <DrawCard icon={GLOBE} iconBg="#26262B" iconFg="#D4D5DA" title="Drawing works on web pages only"
          body="You’re recording a window or your whole screen, so the pen and click rings are off. Record a tab to use them.">
          <button type="button" style={PRIMARY} onClick={onRecordTab}>Record a tab instead</button>
        </DrawCard>
      )}
    </div>
  );
}
