import type { Settings } from './types';

const STORAGE_KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  ai: 'local',
  notesEngine: 'builtin',
  language: 'auto',
  keySource: null,
  capture: { mode: 'tab', mic: true, camera: false, sound: true, quality: '1080p' },
  bubble: { corner: 'bottom-left', size: 'M' },
};

/** Fills every missing field from the defaults, including inside `capture` and `bubble`. */
export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  const s = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    capture: { ...DEFAULT_SETTINGS.capture, ...s.capture },
    bubble: { ...DEFAULT_SETTINGS.bubble, ...s.bubble },
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return mergeSettings(stored[STORAGE_KEY] as Partial<Settings> | undefined);
}

/** Merges top-level fields; `capture` and `bubble` merge one level deeper. Returns the new settings. */
export async function updateSettings(
  partial: Omit<Partial<Settings>, 'capture' | 'bubble'> & {
    capture?: Partial<Settings['capture']>;
    bubble?: Partial<Settings['bubble']>;
  },
): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = {
    ...current,
    ...partial,
    capture: { ...current.capture, ...partial.capture },
    bubble: { ...current.bubble, ...partial.bubble },
  };
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/** Calls `cb` with the full settings whenever they change. Returns an unsubscribe function. */
export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && STORAGE_KEY in changes) cb(mergeSettings(changes[STORAGE_KEY].newValue as Partial<Settings>));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
