export class StoppedError extends Error {
  override name = 'StoppedError';
  constructor() {
    super('Stopped by you');
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
