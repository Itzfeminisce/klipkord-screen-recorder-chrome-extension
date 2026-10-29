import { describe, expect, it } from 'vitest';
import { addressOf, sourceChip } from './sourceChip';

describe('sourceChip', () => {
  it('shows the favicon and title for a tab', () => {
    const tab = { kind: 'tab' as const, title: 'Checkout · Acme Store', url: 'https://acme.com/cart', favIconUrl: 'https://acme.com/f.png' };
    expect(sourceChip('tab', 'A tab', tab)).toEqual({ icon: 'favicon', iconUrl: 'https://acme.com/f.png', text: 'Checkout · Acme Store', title: 'Checkout · Acme Store' });
  });
  it('shows the tab icon and address when the tab has no favicon', () => {
    const tab = { kind: 'tab' as const, title: 'Dev', url: 'http://localhost:3000/x' };
    expect(sourceChip('tab', 'A tab', tab)).toEqual({ icon: 'tab', text: 'localhost:3000', title: 'localhost:3000' });
  });
  it('shows the title when the tab has a favicon but the address is unreadable', () => {
    expect(sourceChip('tab', 'A tab', { kind: 'tab', title: 'T', url: '', favIconUrl: 'x' })?.text).toBe('T');
  });
  it('shows the window icon and the track label for a window', () => {
    expect(sourceChip('window', 'A window', { kind: 'window', label: 'Figma · Onboarding flow' })).toEqual({ icon: 'window', text: 'Figma · Onboarding flow', title: 'Figma · Onboarding flow' });
  });
  it('shows Whole screen for a screen', () => {
    expect(sourceChip('screen', 'Whole screen', { kind: 'screen', label: 'screen:0:0' })?.text).toBe('Whole screen');
  });
  it('falls back to the mode label when nothing is known, or the source is from another mode', () => {
    expect(sourceChip('tab', 'A tab', null)).toEqual({ icon: 'tab', text: 'A tab', title: 'A tab' });
    expect(sourceChip('window', 'A window', { kind: 'window', label: ' ' })?.text).toBe('A window');
    expect(sourceChip('window', 'A window', { kind: 'tab', title: 'x', url: '' })?.text).toBe('A window');
    expect(sourceChip(undefined, '', null)).toBeNull();
  });
  it('falls back to the mode label when the window label is only a source id', () => {
    expect(sourceChip('window', 'A window', { kind: 'window', label: 'window:1234:0' })?.text).toBe('A window');
  });
  it('reads the address without www', () => {
    expect(addressOf('https://www.acme.com/a')).toBe('acme.com');
    expect(addressOf('nope')).toBe('');
  });
});
