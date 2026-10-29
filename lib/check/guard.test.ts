import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoppedError, TimeoutError, cleanupStack, guard, pause, watchdog } from './guard';

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
    await expect(p).rejects.toThrow('Stopped');
  });
});

describe('watchdog', () => {
  it('returns the work result', async () => {
    await expect(watchdog(async () => 7, { ms: 1000, ctl: new AbortController() })).resolves.toBe(7);
  });

  it('times out a stuck test and aborts its signal', async () => {
    const ctl = new AbortController();
    const p = watchdog(() => new Promise(() => {}), { ms: 120_000, ctl });
    const check = expect(p).rejects.toThrow('Timed out after 120 s');
    vi.advanceTimersByTime(120_000);
    await check;
    expect(ctl.signal.aborted).toBe(true);
  });

  it('Stop settles the race even when the work never answers', async () => {
    const ctl = new AbortController();
    const p = watchdog(() => new Promise(() => {}), { ms: 120_000, ctl });
    ctl.abort();
    await expect(p).rejects.toBeInstanceOf(StoppedError);
  });

  it('reports the timeout, not Stop, when the work reacts to the abort', async () => {
    const ctl = new AbortController();
    const p = watchdog((s) => new Promise((_, rej) => s.addEventListener('abort', () => rej(new StoppedError()))), { ms: 1000, ctl });
    const check = expect(p).rejects.toBeInstanceOf(TimeoutError);
    vi.advanceTimersByTime(1000);
    await check;
  });

  it('passes the work error through', async () => {
    await expect(watchdog(async () => Promise.reject(new Error('boom')), { ms: 1000, ctl: new AbortController() })).rejects.toThrow('boom');
  });
});

describe('cleanupStack', () => {
  it('runs newest first, once, and survives a throwing cleanup', () => {
    const order: number[] = [];
    const errors: unknown[] = [];
    const c = cleanupStack();
    c.add(() => order.push(1));
    c.add(() => {
      throw new Error('x');
    });
    c.add(() => order.push(3));
    c.run((e) => errors.push(e));
    c.run();
    expect(order).toEqual([3, 1]);
    expect(errors).toHaveLength(1);
  });
});
