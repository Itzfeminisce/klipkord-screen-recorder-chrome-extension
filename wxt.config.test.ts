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

  it('asks for a site only when drawing is allowed on it, and adds the draw shortcut', async () => {
    const m = await manifest();
    expect(m.optional_host_permissions).toContain('<all_urls>');
    expect(m.host_permissions).not.toContain('<all_urls>');
    const commands = m.commands as Record<string, { suggested_key: { default: string } }>;
    expect(Object.keys(commands)).toHaveLength(4);
    expect(commands['toggle-draw']?.suggested_key.default).toBe('Alt+Shift+D');
    expect(commands['toggle-draw']?.description).toBe('Draw on this page');
  });

  it('puts the extension key in manifest.key', async () => {
    vi.stubEnv('WXT_EXTENSION_KEY', 'test-public-key');
    expect((await manifest()).key).toBe('test-public-key');
  });
});
