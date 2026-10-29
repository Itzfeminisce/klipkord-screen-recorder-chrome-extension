import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoppedError, guard, pause } from './guard';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('guard', () => {
  it('passes a value through', async () => {
    await expect(guard(Promise.resolve(3), { ms: 1000, what: 'x' })).resolves.toBe(3);
  });

  it('rejects with a readable error when a promise never answers', async () => {
    const p = guard(new Promise(() => {}), { ms: 30_000, what: 'Camera' });
    vi.advanceTimersByTime(30_000);
    await expect(p).rejects.toThrow('Camera did not answer within 30 s');
  });

  it('rejects at once when stopped and releases a late value', async () => {
    const ctl = new AbortController();
    let release!: (v: string) => void;
    const dispose = vi.fn();
    const p = guard(new Promise<string>((r) => (release = r)), { ms: 30_000, what: 'x', signal: ctl.signal, dispose });
    ctl.abort();
    await expect(p).rejects.toBeInstanceOf(StoppedError);
    release('stream');
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledWith('stream');
  });

  it('pause ends early when stopped', async () => {
    const ctl = new AbortController();
    const p = pause(60_000, ctl.signal);
    ctl.abort();
    await expect(p).rejects.toThrow('Stopped by you');
  });
});
