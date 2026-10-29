/**
 * Keys held in session memory, from Penv Cloud or pasted by the user, and the check that they work.
 * Keys live only in `browser.storage.session`. Never log or show a value.
 */
import { clearKeys, loadKeys, mergeKeys } from './keys';
import { GRANT_KEY, loadPenvAppKeys } from './penvApp';
import { PROVIDERS } from './llm';
import { getSettings } from './settings';

const STATUS_KEY = 'keyStatus';

/** Forgets every key and the last check from memory. */
export async function forgetAll(): Promise<void> {
  await browser.storage.session.remove([STATUS_KEY, GRANT_KEY]);
  await clearKeys();
}

/** Saves pasted keys (blank ones dropped), merged into the keys already in memory. Returns the key names in memory. */
export async function connectPaste(keys: Record<string, string>): Promise<string[]> {
  const clean = Object.fromEntries(
    Object.entries(keys).map(([k, v]) => [k, v.trim()] as const).filter(([, v]) => v),
  );
  await mergeKeys(clean);
  return Object.keys(await loadKeys()).sort();
}

export type KeyStatus = 'ok' | 'rejected' | 'unreachable';
/** Status per key name. Never holds a key value. */
export type KeyResults = Record<string, KeyStatus>;

/** The cheap "who am I" request for a key name, or null when Klipkord doesn't know that key. */
function checkRequest(name: string, key: string): { url: string; headers: Record<string, string> } | null {
  const provider = Object.values(PROVIDERS).find((p) => p.keyName === name);
  if (!provider) return null;
  if (provider.id === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/models',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    };
  }
  return { url: `${provider.baseUrl}/models`, headers: { Authorization: `Bearer ${key}` } };
}

async function checkOne(
  req: { url: string; headers: Record<string, string> },
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<KeyStatus> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'unreachable'>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve('unreachable');
    }, timeoutMs);
  });
  const call = fetchImpl(req.url, { headers: req.headers, signal: ctrl.signal }).then(
    (res): KeyStatus => (res.status === 401 || res.status === 403 ? 'rejected' : res.ok ? 'ok' : 'unreachable'),
    (): KeyStatus => 'unreachable',
  );
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks every loaded key against its own provider, in parallel. Keys Klipkord doesn't know are skipped.
 * 'rejected' = 401/403; 'unreachable' = network error, other failure or no answer within ~8 s.
 */
export async function checkKeys(
  keys: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<KeyResults> {
  const entries = await Promise.all(
    Object.entries(keys).map(async ([name, value]) => {
      const req = value?.trim() ? checkRequest(name, value.trim()) : null;
      return req ? ([name, await checkOne(req, fetchImpl, timeoutMs)] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter((e): e is readonly [string, KeyStatus] => !!e));
}

/** Remembers the last check (names and statuses only) for this browser session. */
export async function saveKeyStatus(results: KeyResults): Promise<void> {
  await browser.storage.session.set({ [STATUS_KEY]: results });
}

export async function loadKeyStatus(): Promise<KeyResults> {
  const stored = await browser.storage.session.get(STATUS_KEY);
  return (stored[STATUS_KEY] as KeyResults | undefined) ?? {};
}

/**
 * Asks Chrome for access to the sites a connection talks to. Needs a user gesture on the first call;
 * resolves false (never throws) when the user says no or the call is not allowed.
 */
export async function requestHosts(origins: string[]): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins });
  } catch {
    return false;
  }
}

/**
 * Call when the side panel opens. 'ready' if keys are in memory (re-fetching them from Penv Cloud when only
 * the grant is left); 'reconnect' when the user has to connect again (e.g. after a browser restart).
 */
export async function ensureKeys(fetchImpl: typeof fetch = fetch): Promise<'ready' | 'reconnect'> {
  const keys = await loadKeys();
  if (Object.keys(keys).length > 0) return 'ready';
  try {
    const s = await getSettings();
    if (s.keySource === 'penv-app' && s.penvApp) return (await loadPenvAppKeys(s.penvApp, fetchImpl)) ? 'ready' : 'reconnect';
    return 'reconnect';
  } catch {
    return 'reconnect';
  }
}
