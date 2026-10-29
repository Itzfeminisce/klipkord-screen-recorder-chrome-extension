export class StoppedError extends Error {
  override name = 'StoppedError';
  constructor() {
    super('Stopped');
  }
}

export interface GuardOptions<T> {
  ms: number;
  what: string;
  signal?: AbortSignal;
  // Releases a value that arrives after the guard gave up, such as a late camera stream.
  dispose?: (value: T) => void;
}

// Rejects when the promise takes longer than `ms` or the signal aborts, so no await on a device can hang.
export function guard<T>(promise: Promise<T>, o: GuardOptions<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      finish();
      reject(new StoppedError());
    };
    const timer = setTimeout(() => {
      if (settled) return;
      finish();
      reject(new Error(`${o.what} did not answer within ${Math.round(o.ms / 1000)} s`));
    }, o.ms);
    if (o.signal?.aborted) return onAbort();
    o.signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return o.dispose?.(value);
        finish();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        finish();
        reject(error);
      },
    );
  });
}

// A sleep that ends early with StoppedError when the signal aborts.
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return guard(new Promise<void>((r) => setTimeout(r, ms)), { ms: ms + 1000, what: 'pause', signal });
}

export class TimeoutError extends Error {
  override name = 'TimeoutError';
  constructor(ms: number) {
    super(`Timed out after ${Math.round(ms / 1000)} s`);
  }
}

// Hard limit for a whole test. Stop (ctl.abort) and the timer settle the race from outside, so a stuck
// `work` can never block them. Aborts the controller on timeout so the work's own guards let go too.
export function watchdog<T>(work: (signal: AbortSignal) => Promise<T>, o: { ms: number; ctl: AbortController }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const end = () => {
      settled = true;
      clearTimeout(timer);
      o.ctl.signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      end();
      reject(new StoppedError());
    };
    const timer = setTimeout(() => {
      if (settled) return;
      end();
      reject(new TimeoutError(o.ms));
      o.ctl.abort();
    }, o.ms);
    if (o.ctl.signal.aborted) return onAbort();
    o.ctl.signal.addEventListener('abort', onAbort, { once: true });
    let started: Promise<T>;
    try {
      started = work(o.ctl.signal);
    } catch (error) {
      started = Promise.reject(error);
    }
    started.then(
      (value) => {
        if (settled) return;
        end();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        end();
        reject(error);
      },
    );
  });
}

// Cleanups registered by a test; run once, newest first, and one failing never skips the rest.
export function cleanupStack() {
  const fns: (() => void)[] = [];
  return {
    add: (fn: () => void) => void fns.push(fn),
    run: (onError: (e: unknown) => void = () => undefined) => {
      for (const fn of fns.splice(0).reverse()) {
        try {
          fn();
        } catch (error) {
          onError(error);
        }
      }
    },
  };
}
