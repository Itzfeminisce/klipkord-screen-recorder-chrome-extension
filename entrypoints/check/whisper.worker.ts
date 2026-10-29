import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

// The package exports no path to its wasm file.
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

// Extension pages may not load remote code, so ONNX Runtime's wasm ships inside the extension.
env.backends.onnx.wasm!.wasmPaths = { wasm: ortWasmUrl };
env.allowLocalModels = false;
// Threads need cross-origin isolation (set in the manifest); without it ONNX Runtime uses one.
const threads = self.crossOriginIsolated ? Math.max(1, Math.min(4, self.navigator.hardwareConcurrency || 1)) : 1;
env.backends.onnx.wasm!.numThreads = threads;

type Device = 'webgpu' | 'wasm';
// Quantized weights keep the CPU path fast; WebGPU keeps a full-precision encoder.
const DTYPES: Record<Device, Record<string, string>> = {
  webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' },
};
const dtypeText = (d: Device) => Object.entries(DTYPES[d]).map(([k, v]) => `${k}=${v}`).join(' ');

type InMessage =
  | { type: 'load'; model: string }
  | { type: 'transcribe'; id: number; audio: Float32Array }
  | { type: 'dispose' };

let asr: AutomaticSpeechRecognitionPipeline | null = null;

async function create(model: string, device: Device, sizes: Map<string, number>) {
  const dtype = DTYPES[device];
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
  let device: Device = 'wasm';
  let webgpuError: string | null = null;
  const nav = self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  // navigator.gpu can exist with no usable adapter, so ask for one before trying WebGPU.
  let adapter: unknown = null;
  try {
    adapter = nav.gpu ? await nav.gpu.requestAdapter() : null;
  } catch (error) {
    webgpuError = error instanceof Error ? error.message : String(error);
  }
  if (adapter) {
    try {
      asr = await create(model, 'webgpu', sizes);
      device = 'webgpu';
    } catch (error) {
      console.error('Klipkord: could not load Whisper on WebGPU', error);
      webgpuError = error instanceof Error ? error.message : String(error);
    }
  } else {
    webgpuError ??= nav.gpu ? 'no WebGPU adapter' : 'navigator.gpu missing';
  }
  if (!asr) asr = await create(model, 'wasm', sizes);
  let bytes = 0;
  for (const b of sizes.values()) bytes += b;
  self.postMessage({
    type: 'loaded',
    device,
    dtype: dtypeText(device),
    threads: device === 'wasm' ? threads : null,
    crossOriginIsolated: self.crossOriginIsolated,
    webgpuError,
    downloadBytes: bytes,
    loadMs: performance.now() - start,
  });
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
