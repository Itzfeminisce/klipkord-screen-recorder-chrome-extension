import { markInterrupted } from '@/lib/db';
import { commandMessage, onMessage, send } from '@/lib/messages';
import { getRecorderState, hasOffscreen, requestStart, setRecorderState } from '@/lib/capture';
import { MARKER_LABEL, addMarker, markerTime, undoMarker } from '@/lib/markers';
import { formatClock } from '@/lib/time';
import type { MarkerKind } from '@/lib/types';
import { IDLE, badgeTitle, clockElapsed, shortClock, type RecorderState } from '@/lib/recorder';

const DEFAULT_TITLE = 'Open Klipkord';
const LIVE_RED = '#DC2626';
const PAUSED_AMBER = '#FBBF24';

/** Runs inside the page. Self-contained: shown in a shadow root so the page's CSS cannot touch it. */
function showToast(label: string, time: string, recordingId: string, id: string) {
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  const box = document.createElement('div');
  box.setAttribute('role', 'status');
  box.style.cssText = "padding:10px 14px;border-radius:12px;background:#111114;color:#F6F6F7;font:13px system-ui,sans-serif;display:flex;align-items:center;gap:10px;box-shadow:0 8px 24px rgba(16,16,20,0.18)";
  const chip = document.createElement('span');
  chip.textContent = label;
  chip.style.cssText = 'padding:2px 8px;border-radius:999px;background:#3B1D12;color:#FDBA8C;font-size:12px;font-weight:600';
  const text = document.createElement('span');
  text.textContent = `Marked at ${time}`;
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.textContent = 'Undo';
  undo.style.cssText = 'height:28px;padding:0 10px;border:none;border-radius:8px;background:#2C2C32;color:#F6F6F7;font:inherit;font-size:12px;font-weight:600;cursor:pointer';
  const close = () => host.remove();
  undo.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'marker/undo', recordingId, id }).catch(() => undefined);
    close();
  });
  box.append(chip, text, undo);
  root.append(box);
  document.documentElement.append(host);
  setTimeout(close, 6000);
}

export default defineBackground(() => {
  // Kept in memory so a shortcut can act (and open the panel) without waiting on storage.
  let current: RecorderState = IDLE;

  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Klipkord: could not set side panel behaviour', error));

  function setBadge(elapsed: number | null, paused = false) {
    const text = elapsed === null ? '' : shortClock(elapsed);
    void browser.action.setBadgeText({ text }).catch((error) => console.error('Klipkord: could not set the badge', error));
    if (elapsed === null) {
      void browser.action.setTitle({ title: DEFAULT_TITLE });
      return;
    }
    void browser.action.setBadgeBackgroundColor({ color: paused ? PAUSED_AMBER : LIVE_RED });
    void browser.action.setBadgeTextColor?.({ color: paused ? '#111114' : '#FFFFFF' });
    void browser.action.setTitle({ title: paused ? DEFAULT_TITLE : badgeTitle(elapsed) });
  }

  function showState(state: RecorderState) {
    const live = state.status === 'recording' || state.status === 'paused';
    setBadge(live ? clockElapsed(state.clock, Date.now()) : null, state.status === 'paused');
  }

  // Wakes with a recording either still live in the offscreen document, or cut off (then Recovered offers it).
  void (async () => {
    try {
      current = await getRecorderState();
      if (await hasOffscreen()) return showState(current);
      if (current.status !== 'idle' && current.status !== 'done') await setRecorderState((current = IDLE));
      showState(current);
      await markInterrupted();
    } catch (error) {
      console.error('Klipkord: could not restore recorder state', error);
    }
  })();

  onMessage((msg) => {
    if (msg.type === 'marker/undo') {
      return undoMarker(msg.recordingId, msg.id).then(() => true, (error) => {
        console.error('Klipkord: could not undo the marker', error);
        return false;
      });
    }
    if (msg.type === 'recorder/state') {
      current = msg.state;
      void setRecorderState(msg.state).catch((error) => console.error('Klipkord: could not save recorder state', error));
      showState(msg.state);
      if (msg.state.status === 'idle' || msg.state.status === 'done') {
        void chrome.offscreen.closeDocument().catch(() => undefined);
      }
    } else if (msg.type === 'recorder/tick') {
      if (current.status === 'recording') setBadge(msg.elapsed);
    }
    return undefined;
  });

  // Saves the marker first; the toast is a bonus and stays silent where the page cannot take it (chrome:// pages).
  async function shortcutMarker(kind: MarkerKind, tabId: number | undefined) {
    const at = markerTime(current, Date.now());
    if (at === null || !current.recordingId) return;
    const recordingId = current.recordingId;
    const id = await addMarker(recordingId, at, kind);
    if (!id || tabId === undefined) return;
    try {
      await browser.scripting.executeScript({ target: { tabId }, func: showToast, args: [MARKER_LABEL[kind], formatClock(at), recordingId, id] });
    } catch {
      // No toast on pages the extension may not script.
    }
  }

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === 'toggle-recording') {
      if (current.status === 'recording' || current.status === 'paused') return void send({ type: 'recorder/stop' });
      if (current.status === 'armed' || current.status === 'saving') return;
      // Opening the panel must happen inside the shortcut's user gesture, before any await.
      const windowId = tab?.windowId;
      if (windowId !== undefined) {
        browser.sidePanel.open({ windowId }).catch((error) => console.error('Klipkord: could not open the side panel', error));
      }
      void requestStart().catch((error) => console.error('Klipkord: could not start recording', error));
      return;
    }
    if (command === 'toggle-pause') {
      if (current.status === 'recording') void send({ type: 'recorder/pause' });
      else if (current.status === 'paused') void send({ type: 'recorder/resume' });
      return;
    }
    const msg = commandMessage(command);
    if (msg?.type === 'marker/add') {
      void shortcutMarker(msg.kind, tab?.id).catch((error) => console.error('Klipkord: could not save the marker', error));
    } else if (msg) void send(msg);
  });

  // A browser restart ends any capture, so whatever was live is now unfinished (Recovered offers it).
  browser.runtime.onStartup.addListener(() => {
    markInterrupted().catch((error) => console.error('Klipkord: could not mark interrupted recordings', error));
  });
});
