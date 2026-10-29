import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { GifPlan } from '@/lib/check/v2';

// Draws screen-like frames (text, a moving window, a cursor) so the palette work is realistic.
function drawFrame(ctx: OffscreenCanvasRenderingContext2D, plan: GifPlan, i: number) {
  const { width: w, height: h } = plan;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#1d3557');
  g.addColorStop(1, `hsl(${(i * 2) % 360} 60% 45%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const x = ((i * 4) % (w + 200)) - 200;
  ctx.fillStyle = '#f1faee';
  ctx.fillRect(x, h * 0.25, 200, h * 0.5);
  ctx.fillStyle = '#111';
  ctx.font = '14px sans-serif';
  for (let line = 0; line < 8; line++) ctx.fillText(`Line ${line + 1} of frame ${i}`, x + 10, h * 0.25 + 22 + line * 20);
  ctx.fillStyle = '#e63946';
  ctx.beginPath();
  ctx.arc(w / 2 + Math.cos(i / 6) * w * 0.3, h / 2 + Math.sin(i / 6) * h * 0.3, 8, 0, Math.PI * 2);
  ctx.fill();
}

self.onmessage = (event: MessageEvent<GifPlan>) => {
  try {
    const plan = event.data;
    const canvas = new OffscreenCanvas(plan.width, plan.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const gif = GIFEncoder();
    let drawMs = 0;
    const start = performance.now();
    for (let i = 0; i < plan.frames; i++) {
      const d = performance.now();
      drawFrame(ctx, plan, i);
      const rgba = ctx.getImageData(0, 0, plan.width, plan.height).data;
      drawMs += performance.now() - d;
      const palette = quantize(rgba, 256);
      gif.writeFrame(applyPalette(rgba, palette), plan.width, plan.height, { palette, delay: plan.delayMs });
      if (i % 12 === 0) self.postMessage({ type: 'progress', frame: i + 1 });
    }
    gif.finish();
    const bytes = gif.bytes();
    const buffer = bytes.buffer as ArrayBuffer;
    const ms = performance.now() - start;
    self.postMessage({ type: 'done', ms, drawMs, bytes: bytes.byteLength, gif: buffer }, { transfer: [buffer] });
  } catch (error) {
    console.error('Klipkord: could not encode the GIF', error);
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
