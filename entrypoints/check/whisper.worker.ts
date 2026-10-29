import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

// The package exports no path to its wasm file.
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

// Extension pages may not load remote code, so ONNX Runtime's wasm ships inside the extension.
env.backends.onnx.wasm!.wasmPaths = { wasm: ortWasmUrl };
env.allowLocalModels = false;

type InMessage =
  | { type: 'load'; model: string }
  | { type: 'transcribe'; id: number; audio: Float32Array }
  | { type: 'dispose' };

let asr: AutomaticSpeechRecognitionPipeline | null = null;

async function create(model: string, device: 'webgpu' | 'wasm', sizes: Map<string, number>) {
  const dtype =
    device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' };
  // Cast keeps tsc from expanding the pipeline's task overloads.
  const make = pipeline as (task: string, model: string, options: object) => Promise<unknown>;
  return (await make('automatic-speech-recognition', model, {
    device,
    dtype,
    progress_callback: (p: { status: string; file?: string; total?: number }) => {
      if (p.status === 'progress' && p.file && p.total) sizes.set(p.file, p.total);
    },
  })) as AutomaticSpeechRecognitionPipeline;
}

async function load(model: string) {
  const sizes = new Map<string, number>();
  const start = performance.now();
  let device: 'webgpu' | 'wasm' = 'wasm';
  let webgpuError: string | null = null;
  const nav = self.navigator as Navigator & { gpu?: unknown };
  if (nav.gpu) {
    try {
      asr = await create(model, 'webgpu', sizes);
      device = 'webgpu';
    } catch (error) {
      console.error('Klipkord: could not load Whisper on WebGPU', error);
      webgpuError = error instanceof Error ? error.message : String(error);
    }
  } else {
    webgpuError = 'navigator.gpu missing';
  }
  if (!asr) asr = await create(model, 'wasm', sizes);
  let bytes = 0;
  for (const b of sizes.values()) bytes += b;
  self.postMessage({ type: 'loaded', device, webgpuError, downloadBytes: bytes, loadMs: performance.now() - start });
}

async function transcribe(id: number, audio: Float32Array) {
  if (!asr) throw new Error('model not loaded');
  const start = performance.now();
  const out = (await asr(audio)) as { text: string };
  const words = out.text.trim() ? out.text.trim().split(/\s+/).length : 0;
  self.postMessage({ type: 'done', id, ms: performance.now() - start, words });
}

async function handle(msg: InMessage) {
  try {
    if (msg.type === 'load') await load(msg.model);
    else if (msg.type === 'transcribe') await transcribe(msg.id, msg.audio);
    else if (msg.type === 'dispose') {
      await asr?.dispose();
      asr = null;
      self.postMessage({ type: 'disposed' });
    }
  } catch (error) {
    console.error('Klipkord: could not run Whisper', error);
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

// One message at a time, so answers come back in the order asked.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<InMessage>) => {
  queue = queue.then(() => handle(event.data));
};
