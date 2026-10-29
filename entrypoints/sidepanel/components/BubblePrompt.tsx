import { useEffect, useState } from 'react';
import type { BubbleStatus } from '@/lib/bubble';
import { onMessage, send } from '@/lib/messages';

/** Brings the pinned recorder tab and its window to the front. */
async function goToRecorderTab(status: BubbleStatus) {
  try {
    if (status.tabId !== undefined) await browser.tabs.update(status.tabId, { active: true });
    if (status.windowId !== undefined) await browser.windows.update(status.windowId, { focused: true });
  } catch (error) {
    console.error('Klipkord: could not open the recorder tab', error);
  }
}

/** StatesDraw `bubble-in-recorder-tab`: shown on Recording until the floating bubble opens. */
export function BubblePrompt() {
  const [status, setStatus] = useState<BubbleStatus | null>(null);
  useEffect(() => {
    let live = true;
    void send<BubbleStatus>({ type: 'bubble/get' }).then((s) => live && s && setStatus(s));
    const off = onMessage((msg) => {
      if (msg.type === 'bubble/status') setStatus(msg.status);
      return undefined;
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  if (!status?.wanted || status.open) return null;

  return (
    <div role="status" style={{ margin: '14px 24px 0', padding: 14, borderRadius: 16, background: '#1A1A1F', color: '#F6F6F7', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#3B1D12', color: '#FDBA8C', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Turn on your camera bubble</span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: '#B4B5BC' }}>Go to the pinned Klipkord recorder tab and click Show camera bubble. Chrome needs that one click to open it.</span>
        </span>
      </div>
      <button type="button" onClick={() => void goToRecorderTab(status)}
        style={{ alignSelf: 'flex-start', height: 36, padding: '0 14px', border: 'none', borderRadius: 10, background: '#F6F6F7', color: '#111114', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        Go to the recorder tab
      </button>
    </div>
  );
}
