import { GIFEncoder, applyPalette, quantize } from 'gifenc';

export type GifIn =
  | { type: 'start'; width: number; height: number; delayMs: number }
  | { type: 'frame'; rgba: ArrayBuffer }
  | { type: 'finish' };
export type GifOut = { type: 'progress'; frames: number } | { type: 'done'; gif: ArrayBuffer } | { type: 'error'; message: string };

let gif: ReturnType<typeof GIFEncoder> | undefined;
let size = { width: 0, height: 0, delayMs: 80 };
let frames = 0;

const post = (message: GifOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = (event: MessageEvent<GifIn>) => {
  const m = event.data;
  try {
    if (m.type === 'start') {
      gif = GIFEncoder();
      size = { width: m.width, height: m.height, delayMs: m.delayMs };
      frames = 0;
    } else if (m.type === 'frame' && gif) {
      const rgba = new Uint8ClampedArray(m.rgba);
      const palette = quantize(rgba, 256);
      gif.writeFrame(applyPalette(rgba, palette), size.width, size.height, { palette, delay: size.delayMs });
      post({ type: 'progress', frames: ++frames });
    } else if (m.type === 'finish' && gif) {
      gif.finish();
      const bytes = gif.bytes();
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      gif = undefined;
      post({ type: 'done', gif: buffer }, [buffer]);
    }
  } catch (error) {
    console.error('Klipkord: could not encode the GIF', error);
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
