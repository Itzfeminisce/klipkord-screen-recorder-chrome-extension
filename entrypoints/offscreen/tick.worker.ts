// Timers in a hidden document can be throttled; a worker's are not, so it keeps the 30 fps clock.
let timer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (e: MessageEvent<{ fps: number } | null>) => {
  clearInterval(timer);
  if (e.data) timer = setInterval(() => self.postMessage(0), 1000 / e.data.fps);
};
