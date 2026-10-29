import { useEffect, useState } from 'react';
import { send, type Message, type MessageOf } from './messages';
import { IDLE, type RecorderState } from './recorder';
import type { CaptureMode, Quality } from './types';

export const RECORDER_PATH = '/offscreen.html';
const STATE_KEY = 'recorder';
const START_KEY = 'startRequested';

type Source = `${chrome.desktopCapture.DesktopCaptureSourceType}`;

/** Sources Chrome's picker offers for the chosen mode. 'audio' adds the share-sound checkbox. */
export function pickerSources(mode: CaptureMode, sound: boolean): Source[] {
  const base: Source[] = mode === 'tab' ? ['tab'] : mode === 'window' ? ['window'] : ['screen'];
  return sound && mode !== 'window' ? [...base, 'audio'] : base;
}

/** Capture size for the quality, never above the real screen (T0: 1366x768 when 1080p was asked for). */
export function captureSize(quality: Quality, screenWidth: number, screenHeight: number): { maxWidth: number; maxHeight: number } {
  const [w, h] = quality === '1080p' ? [1920, 1080] : [1280, 720];
  const sw = screenWidth > 0 ? Math.round(screenWidth) : w;
  const sh = screenHeight > 0 ? Math.round(screenHeight) : h;
  return { maxWidth: Math.min(w, sw), maxHeight: Math.min(h, sh) };
}

export interface Picked { streamId: string; canRequestAudioTrack: boolean }

/** Chrome's picker; null when the person cancels. Its stream id works only in the page that called it. */
export function pickSource(mode: CaptureMode, sound: boolean): Promise<Picked | null> {
  return new Promise((resolve) => {
    chrome.desktopCapture.chooseDesktopMedia(pickerSources(mode, sound) as chrome.desktopCapture.DesktopCaptureSourceType[], (streamId, options) => {
      resolve(streamId ? { streamId, canRequestAudioTrack: Boolean(options?.canRequestAudioTrack) } : null);
    });
  });
}

async function recorderTabIds(): Promise<number[]> {
  const url = browser.runtime.getURL(RECORDER_PATH);
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB], documentUrls: [url] });
  return contexts.map((c) => c.tabId).filter((id) => id >= 0);
}

export async function hasRecorder(): Promise<boolean> {
  return (await recorderTabIds()).length > 0;
}

/**
 * The pinned recorder tab, opened when missing. An offscreen document cannot use a picked stream id
 * (Chrome: "AbortError: Error starting tab capture"), so the picker and the recording share this tab.
 */
export async function ensureRecorder(windowId?: number): Promise<chrome.tabs.Tab> {
  const [id] = await recorderTabIds();
  if (id !== undefined) return chrome.tabs.get(id);
  const tab = await chrome.tabs.create({ url: RECORDER_PATH, pinned: true, active: false, windowId });
  for (let i = 0; i < 100; i++) {
    if ((await send({ type: 'offscreen/busy' })) !== undefined) return tab;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('The recorder tab did not load');
}

export async function closeRecorder(): Promise<void> {
  const ids = await recorderTabIds();
  if (ids.length) await chrome.tabs.remove(ids);
}

/**
 * Prepares the recorder: Chrome's picker opens over the recorder tab, shown for the pick, then the
 * person's tab comes back. `cancelled` when nothing was picked.
 */
export async function prepareRecorder(msg: Omit<MessageOf<'recorder/prepare'>, 'type'>): Promise<RecorderReply> {
  const [previous] = await chrome.tabs.query({ active: true, currentWindow: true });
  const recorder = await ensureRecorder(previous?.windowId);
  if (recorder.id === undefined) throw new Error('The recorder tab has no id');
  await chrome.tabs.update(recorder.id, { active: true });
  if (previous && recorder.windowId !== previous.windowId) await chrome.windows.update(recorder.windowId, { focused: true });
  try {
    return await command({ type: 'recorder/prepare', ...msg });
  } finally {
    if (previous?.id !== undefined && previous.id !== recorder.id) {
      await chrome.tabs.update(previous.id, { active: true }).catch((error) => console.error('Klipkord: could not return to the tab', error));
      if (recorder.windowId !== previous.windowId) await chrome.windows.update(previous.windowId, { focused: true }).catch(() => undefined);
    }
  }
}

export interface RecorderReply { ok: boolean; error?: string; cancelled?: boolean }

/** Sends a command to the recorder tab and waits for its answer. */
export async function command(msg: Message): Promise<RecorderReply> {
  return (await send<RecorderReply>(msg)) ?? { ok: false, error: 'no recorder' };
}

export async function getRecorderState(): Promise<RecorderState> {
  const stored = await browser.storage.session.get(STATE_KEY);
  return (stored[STATE_KEY] as RecorderState | undefined) ?? IDLE;
}

export async function setRecorderState(state: RecorderState): Promise<void> {
  await browser.storage.session.set({ [STATE_KEY]: state });
}

export function onRecorderState(cb: (state: RecorderState) => void): () => void {
  const listener = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
    if (area === 'session' && changes[STATE_KEY]) cb((changes[STATE_KEY].newValue as RecorderState | undefined) ?? IDLE);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Live recorder state for a screen; null until the first read. */
export function useRecorder(): RecorderState | null {
  const [state, setState] = useState<RecorderState | null>(null);
  useEffect(() => {
    let live = true;
    const off = onRecorderState((s) => live && setState(s));
    getRecorderState()
      .then((s) => live && setState((cur) => cur ?? s))
      .catch((error) => console.error('Klipkord: could not read recorder state', error));
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

/** Re-renders every `ms` so timers move. */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Alt+Shift+R with the panel closed: the background opens it and leaves this flag for Home. */
export async function requestStart(): Promise<void> {
  await browser.storage.session.set({ [START_KEY]: true });
}

export async function takeStartRequest(): Promise<boolean> {
  const stored = await browser.storage.session.get(START_KEY);
  if (!stored[START_KEY]) return false;
  await browser.storage.session.remove(START_KEY);
  return true;
}

export function onStartRequest(cb: () => void): () => void {
  const listener = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
    if (area === 'session' && changes[START_KEY]?.newValue) cb();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
