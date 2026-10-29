import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, getSettings, mergeSettings, onSettingsChanged, updateSettings } from './settings';

describe('settings', () => {
  beforeEach(() => fakeBrowser.reset());

  it('returns defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('fills missing nested fields from the defaults', () => {
    const s = mergeSettings({ language: 'en', capture: { mode: 'screen' } as never });
    expect(s.language).toBe('en');
    expect(s.capture).toEqual({ ...DEFAULT_SETTINGS.capture, mode: 'screen' });
    expect(s.bubble).toEqual(DEFAULT_SETTINGS.bubble);
  });

  it('has the v2 defaults', () => {
    expect(DEFAULT_SETTINGS.bubble.mode).toBe('floating');
    expect(DEFAULT_SETTINGS.draw).toEqual({ tool: 'pen', color: '#C2410C' });
    expect(DEFAULT_SETTINGS.cleanup).toEqual({ pauses: true, fillers: true, minPause: 2 });
    expect(DEFAULT_SETTINGS.drive).toBeUndefined();
  });

  it('fills the v2 fields into stored v1 settings', () => {
    const s = mergeSettings({ bubble: { corner: 'top-right', size: 'S' }, cleanup: { minPause: 3 } as never });
    expect(s.bubble).toEqual({ corner: 'top-right', size: 'S', mode: 'floating' });
    expect(s.draw).toEqual(DEFAULT_SETTINGS.draw);
    expect(s.cleanup).toEqual({ pauses: true, fillers: true, minPause: 3 });
  });

  it('merges draw and cleanup one level deep', async () => {
    await updateSettings({ draw: { tool: 'rings' }, cleanup: { fillers: false } });
    const s = await getSettings();
    expect(s.draw).toEqual({ tool: 'rings', color: '#C2410C' });
    expect(s.cleanup).toEqual({ pauses: true, fillers: false, minPause: 2 });
  });

  it('merges partial updates one level deep', async () => {
    await updateSettings({ capture: { quality: '720p' }, bubble: { size: 'L' } });
    await updateSettings({ ai: 'cloud', capture: { mic: false } });
    const s = await getSettings();
    expect(s.ai).toBe('cloud');
    expect(s.capture).toEqual({ ...DEFAULT_SETTINGS.capture, quality: '720p', mic: false });
    expect(s.bubble).toEqual({ corner: 'bottom-left', size: 'L', mode: 'floating' });
  });

  it('notifies listeners and unsubscribes', async () => {
    const cb = vi.fn();
    const off = onSettingsChanged(cb);
    await updateSettings({ language: 'fr' });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ language: 'fr' }));
    off();
    await updateSettings({ language: 'de' });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
