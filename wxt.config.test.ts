import { afterEach, describe, expect, it, vi } from 'vitest';

const V1_PERMISSIONS = ['sidePanel', 'offscreen', 'desktopCapture', 'storage', 'unlimitedStorage', 'identity', 'activeTab', 'scripting'];

async function manifest() {
  vi.resetModules();
  // Typed loosely: the config's manifest field also allows a function form.
  return ((await import('./wxt.config')).default as { manifest: Record<string, unknown> }).manifest;
}

describe('manifest', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('adds Google APIs as an optional host and no new required permission', async () => {
    const m = await manifest();
    expect(m.permissions).toEqual(V1_PERMISSIONS);
    expect(m.host_permissions).toEqual(['https://huggingface.co/*', 'https://*.hf.co/*']);
    expect(m.optional_host_permissions).toContain('https://www.googleapis.com/*');
  });

  it('puts the extension key in manifest.key', async () => {
    vi.stubEnv('WXT_EXTENSION_KEY', 'test-public-key');
    expect((await manifest()).key).toBe('test-public-key');
  });
});
