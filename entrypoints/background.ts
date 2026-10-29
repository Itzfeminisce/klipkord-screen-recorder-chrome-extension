import { markInterrupted } from '@/lib/db';
import { commandMessage, onMessage, send } from '@/lib/messages';
import { getRecorderState, hasOffscreen, requestStart, setRecorderState } from '@/lib/capture';
import { IDLE, badgeTitle, clockElapsed, shortClock, type RecorderState } from '@/lib/recorder';

const DEFAULT_TITLE = 'Open Klipkord';
const LIVE_RED = '#DC2626';
const PAUSED_AMBER = '#FBBF24';

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
    if (msg) void send(msg);
  });

  // A browser restart ends any capture, so whatever was live is now unfinished (Recovered offers it).
  browser.runtime.onStartup.addListener(() => {
    markInterrupted().catch((error) => console.error('Klipkord: could not mark interrupted recordings', error));
  });
});
