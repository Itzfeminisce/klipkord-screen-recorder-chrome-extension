import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { commandMessage, onMessage, send } from './messages';

describe('messages', () => {
  beforeEach(() => fakeBrowser.reset());

  it('maps each keyboard command to its message', () => {
    expect(commandMessage('toggle-recording')).toEqual({ type: 'recording/toggle' });
    expect(commandMessage('toggle-pause')).toEqual({ type: 'recording/pause' });
    expect(commandMessage('add-marker')).toEqual({ type: 'marker/add', kind: 'step' });
    expect(commandMessage('nope')).toBeUndefined();
  });

  it('delivers a message and its reply', async () => {
    const off = onMessage((msg) => (msg.type === 'recording/pause' ? 'ok' : undefined));
    expect(await send({ type: 'recording/pause' })).toBe('ok');
    off();
  });
});
