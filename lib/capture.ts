import { useEffect, useState } from 'react';
import { send, type Message } from './messages';
import { IDLE, type RecorderState } from './recorder';
import type { CaptureMode, Quality } from './types';

export const OFFSCREEN_PATH = '/offscreen.html';
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

/** Chrome's picker from the side panel; null when the person cancels. The id is used by the offscreen document. */
export function pickSource(mode: CaptureMode, sound: boolean): Promise<Picked | null> {
  return new Promise((resolve) => {
    chrome.desktopCapture.chooseDesktopMedia(pickerSources(mode, sound) as chrome.desktopCapture.DesktopCaptureSourceType[], (streamId, options) => {
      resolve(streamId ? { streamId, canRequestAudioTrack: Boolean(options?.canRequestAudioTrack) } : null);
    });
  });
}

export async function ensureOffscreen(): Promise<void> {
  const url = browser.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.DISPLAY_MEDIA],
    justification: 'Records the screen, mic and sound while the side panel is closed.',
  });
}

export async function hasOffscreen(): Promise<boolean> {
  const url = browser.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  return contexts.length > 0;
}

export interface RecorderReply { ok: boolean; error?: string }

/** Sends a command to the offscreen recorder and waits for its answer. */
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
