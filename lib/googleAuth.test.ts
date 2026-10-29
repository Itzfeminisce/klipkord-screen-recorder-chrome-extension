import { describe, expect, it } from 'vitest';
import { DRIVE_SCOPE, authUrl, googleConfigured, parseTokenRedirect, signInError, tokenUsable } from './googleAuth';

const REDIRECT = 'https://fakeextensionid.chromiumapp.org/';

describe('Google sign-in', () => {
  it('asks for an implicit token with drive.file only', () => {
    const u = new URL(authUrl('fake-client.apps.googleusercontent.com', REDIRECT, 'state-1'));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('response_type')).toBe('token');
    expect(u.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(u.searchParams.get('state')).toBe('state-1');
  });

  it('reads the token and its expiry from the fragment', () => {
    const t = parseTokenRedirect(`${REDIRECT}#access_token=fake-token&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent(DRIVE_SCOPE)}&state=s`, 's', 1000);
    expect(t).toEqual({ token: 'fake-token', expiresAt: 1000 + 3599 * 1000 });
  });

  it('rejects a different state, an error and a missing token', () => {
    expect(() => parseTokenRedirect(`${REDIRECT}#access_token=fake-token&state=other`, 's', 0)).toThrow();
    expect(() => parseTokenRedirect(`${REDIRECT}#error=access_denied&state=s`, 's', 0)).toThrow(/access_denied/);
    expect(() => parseTokenRedirect(`${REDIRECT}#state=s`, 's', 0)).toThrow();
  });

  it('drops a token that is about to expire', () => {
    expect(tokenUsable({ token: 'fake-token', expiresAt: 10 * 60_000 }, 0)).toBe(true);
    expect(tokenUsable({ token: 'fake-token', expiresAt: 30_000 }, 0)).toBe(false);
    expect(tokenUsable(undefined, 0)).toBe(false);
  });

  it('is not set up without a client id', () => {
    expect(googleConfigured('')).toBe(false);
    expect(googleConfigured('fake-client.apps.googleusercontent.com')).toBe(true);
  });
});

describe('signInError', () => {
  it('tells a closed or refused window from a Google failure', () => {
    expect(signInError(new Error('The user did not approve access.'))).toBe(false);
    expect(signInError(new Error('Google sign-in failed: access_denied'))).toBe(false);
    expect(signInError(new Error('Authorization page could not be loaded.'))).toBe(true);
  });
});
