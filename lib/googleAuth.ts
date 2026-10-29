/** Google sign-in for Drive links: implicit-flow token through launchWebAuthFlow, kept only in chrome.storage.session. */

// Public OAuth client id (O2), set at build time; empty until the owner creates the client.
// Klipkord's Google OAuth client (Web application, redirect https://iapgbifdchhmidblniddncnagghloepi.chromiumapp.org/). It is public.
const KLIPKORD_CLIENT_ID = '503949808619-egjguop1pgr0imp7pj7ej19g1b8afifo.apps.googleusercontent.com';
export const GOOGLE_CLIENT_ID: string = (import.meta.env.WXT_GOOGLE_CLIENT_ID as string | undefined) || KLIPKORD_CLIENT_ID;
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_ORIGINS = ['https://www.googleapis.com/*'];
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_KEY = 'googleToken';
// Treat a token as gone a minute early so an upload doesn't start on one about to expire.
const EARLY_MS = 60_000;

export interface GoogleToken { token: string; expiresAt: number }

export const googleConfigured = (clientId = GOOGLE_CLIENT_ID): boolean => clientId.trim().length > 0;

export function authUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: DRIVE_SCOPE,
    state,
    include_granted_scopes: 'false',
  });
  return `${AUTH_ENDPOINT}?${q.toString()}`;
}

/** Reads the token from the redirect's fragment; throws when Google sent an error or the state differs. */
export function parseTokenRedirect(redirected: string, state: string, now: number): GoogleToken {
  const hash = redirected.includes('#') ? redirected.slice(redirected.indexOf('#') + 1) : '';
  const p = new URLSearchParams(hash || (redirected.includes('?') ? redirected.slice(redirected.indexOf('?') + 1) : ''));
  const error = p.get('error');
  if (error) throw new Error(`Google sign-in failed: ${error}`);
  if (p.get('state') !== state) throw new Error('Google sign-in returned a different state');
  const token = p.get('access_token');
  if (!token) throw new Error('Google sign-in returned no token');
  if (!(p.get('scope') ?? DRIVE_SCOPE).split(' ').includes(DRIVE_SCOPE)) throw new Error('Google sign-in did not grant Drive access');
  const seconds = Number(p.get('expires_in') ?? '3600');
  return { token, expiresAt: now + (Number.isFinite(seconds) ? seconds : 3600) * 1000 };
}

export const tokenUsable = (t: GoogleToken | undefined, now: number): t is GoogleToken => !!t && t.expiresAt - EARLY_MS > now;

export async function getGoogleToken(): Promise<string | undefined> {
  const stored = (await browser.storage.session.get(TOKEN_KEY))[TOKEN_KEY] as GoogleToken | undefined;
  return tokenUsable(stored, Date.now()) ? stored.token : undefined;
}

/** Runs in a click: asks for Google's host, then shows Google's consent window. */
export async function connectGoogle(): Promise<string> {
  if (!googleConfigured()) throw new Error('WXT_GOOGLE_CLIENT_ID is not set in this build');
  if (!(await browser.permissions.request({ origins: GOOGLE_ORIGINS }))) throw new Error('Google access was not allowed');
  const state = crypto.randomUUID();
  const redirected = await browser.identity.launchWebAuthFlow({ url: authUrl(GOOGLE_CLIENT_ID, browser.identity.getRedirectURL(), state), interactive: true });
  if (!redirected) throw new Error('Google sign-in was closed');
  const t = parseTokenRedirect(redirected, state, Date.now());
  await browser.storage.session.set({ [TOKEN_KEY]: t });
  return t.token;
}

export const forgetGoogleToken = (): Promise<void> => browser.storage.session.remove(TOKEN_KEY);
