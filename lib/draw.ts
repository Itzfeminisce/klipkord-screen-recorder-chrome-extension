import type { CaptureMode } from './types';
import type { RecorderState } from './recorder';

export interface Pt { x: number; y: number }

/** Each new point moves this far toward the pointer, which takes the jitter out of a hand-drawn line. */
export const SMOOTHING = 0.5;

export function smoothPoint(prev: Pt | undefined, raw: Pt, weight = SMOOTHING): Pt {
  if (!prev) return raw;
  return { x: prev.x + (raw.x - prev.x) * weight, y: prev.y + (raw.y - prev.y) * weight };
}

/** The smoothed stroke; first and last points stay where the pointer went down and up. */
export function smoothStroke(points: Pt[], weight = SMOOTHING): Pt[] {
  const out: Pt[] = [];
  for (const p of points) out.push(smoothPoint(out[out.length - 1], p, weight));
  if (points.length > 1) out[out.length - 1] = points[points.length - 1]!;
  return out;
}

export const RING_MS = 600;
const RING_FROM = 14;
const RING_TO = 26;
const RING_OPACITY = 0.7;

/** A click ring `age` ms after the click: it grows and fades out over RING_MS, then is gone. */
export function ringAt(age: number): { radius: number; opacity: number } | null {
  if (age < 0 || age >= RING_MS) return null;
  const t = age / RING_MS;
  return { radius: RING_FROM + (RING_TO - RING_FROM) * t, opacity: RING_OPACITY * (1 - t) };
}

export type DrawAvailability = 'off' | 'tab' | 'web-only';

/** The pen only reaches a web page, so a window or screen recording gets the web-only card. */
export function drawAvailability(state: Pick<RecorderState, 'status' | 'mode'> | null): DrawAvailability {
  if (!state || (state.status !== 'recording' && state.status !== 'paused')) return 'off';
  return state.mode === 'window' || state.mode === 'screen' ? 'web-only' : 'tab';
}

/** `https://site.example/*` for a web page; null where Chrome never lets an extension draw. */
export function originPattern(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? `${u.origin}/*` : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string | undefined): string | null {
  return originPattern(url) ? new URL(url!).hostname : null;
}

const DRAW_KEY = 'klipkord.draw';
const OVERLAY_FILE = '/content-scripts/draw.js';

/** The tab the overlay was last put in and its page, so the switch and the stop know where it is. */
export interface DrawTarget { tabId: number; url?: string; on: boolean }

export async function getDrawTarget(): Promise<DrawTarget | null> {
  const stored = await browser.storage.session.get(DRAW_KEY);
  return (stored[DRAW_KEY] as DrawTarget | undefined) ?? null;
}

async function setDrawTarget(target: DrawTarget | null): Promise<void> {
  if (target) await browser.storage.session.set({ [DRAW_KEY]: target });
  else await browser.storage.session.remove(DRAW_KEY);
}

export async function overlayOn(tabId: number): Promise<boolean> {
  try {
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => Boolean((globalThis as { klipkordDraw?: unknown }).klipkordDraw),
    });
    return res?.result === true;
  } catch {
    return false;
  }
}

/** Puts the overlay in the tab; throws where the extension may not script the page. */
export async function injectOverlay(tabId: number, url?: string): Promise<void> {
  const previous = await getDrawTarget();
  if (previous?.on && previous.tabId !== tabId) await removeOverlay(previous.tabId);
  await browser.scripting.executeScript({ target: { tabId }, files: [OVERLAY_FILE] });
  await setDrawTarget({ tabId, url: url ?? (previous?.tabId === tabId ? previous.url : undefined), on: true });
}

export async function removeOverlay(tabId: number): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: () => (globalThis as { klipkordDraw?: { remove: () => void } }).klipkordDraw?.remove(),
    });
  } catch {
    // The page was closed or navigated away, which took the overlay with it.
  }
  const target = await getDrawTarget();
  if (target?.tabId === tabId) await setDrawTarget({ ...target, on: false });
}

/** Stop leaves nothing on the page. */
export async function endDraw(state: Pick<RecorderState, 'status'>): Promise<void> {
  if (state.status === 'recording' || state.status === 'paused') return;
  const target = await getDrawTarget();
  if (!target) return;
  if (target.on) await removeOverlay(target.tabId);
  await setDrawTarget(null);
}

/** Alt+Shift+D: the shortcut grants activeTab, so this works on any web page of a tab recording. */
export async function toggleDrawShortcut(tab: { id?: number; url?: string } | undefined, state: RecorderState): Promise<void> {
  if (drawAvailability(state) !== 'tab' || tab?.id === undefined) return;
  const target = await getDrawTarget();
  if (target?.tabId === tab.id && (await overlayOn(tab.id))) return removeOverlay(tab.id);
  await injectOverlay(tab.id, tab.url);
}

/** Calls back whenever the overlay goes on or off, from the panel or the shortcut. */
export function onDrawTarget(cb: (target: DrawTarget | null) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'session' && DRAW_KEY in changes) cb((changes[DRAW_KEY]!.newValue as DrawTarget | undefined) ?? null);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
