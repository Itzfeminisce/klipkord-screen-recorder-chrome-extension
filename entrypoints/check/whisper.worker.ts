import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

// The package exports no path to its wasm file.
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

const errorMessage = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

// Any failure, even one outside a handled message, goes back to the page at once.
self.addEventListener('unhandledrejection', (event) => {
  self.postMessage({ type: 'error', message: `Whisper worker: ${errorMessage(event.reason)}` });
});
self.addEventListener('error', (event) => {
  self.postMessage({ type: 'error', message: `Whisper worker: ${event.message || 'error'}` });
});

// Extension pages may not load remote code, so ONNX Runtime's wasm ships inside the extension.
env.backends.onnx.wasm!.wasmPaths = { wasm: ortWasmUrl };
env.allowLocalModels = false;
// The page is not cross-origin isolated, so ONNX Runtime runs one wasm thread.
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
  | { type: 'load'; model: string; device?: Device }
  | { type: 'transcribe'; id: number; audio: Float32Array; timestamps?: 'word' }
  | { type: 'probe'; url: string }
  | { type: 'dispose' };

interface Progress {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

let asr: AutomaticSpeechRecognitionPipeline | null = null;

async function create(model: string, device: Device) {
  const dtype = DTYPES[device];
  // Cast keeps tsc from expanding the pipeline's task overloads.
  const make = pipeline as (task: string, model: string, options: object) => Promise<unknown>;
  return (await make('automatic-speech-recognition', model, {
    device,
    dtype,
    // Progress messages are not answers; the page shows them as they come.
    progress_callback: (p: Progress) => {
      if (!p.file) return;
      self.postMessage({ type: 'progress', device, status: p.status, file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
    },
  })) as AutomaticSpeechRecognitionPipeline;
}

async function load(model: string, only?: Device) {
  let device: Device = 'wasm';
  if (only === 'wasm') return loaded(await create(model, 'wasm'), 'wasm', 'skipped: wasm asked for');
  let webgpuError: string | null = null;
  const nav = self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  // navigator.gpu can exist with no usable adapter, so ask for one before trying WebGPU.
  let adapter: unknown = null;
  try {
    adapter = nav.gpu ? await nav.gpu.requestAdapter() : null;
  } catch (error) {
    webgpuError = errorMessage(error);
  }
  if (adapter) {
    try {
      asr = await create(model, 'webgpu');
      device = 'webgpu';
    } catch (error) {
      console.error('Klipkord: could not load Whisper on WebGPU', error);
      webgpuError = errorMessage(error);
    }
  } else {
    webgpuError ??= nav.gpu ? 'no WebGPU adapter' : 'navigator.gpu missing';
  }
  loaded(asr ?? (await create(model, 'wasm')), device, webgpuError);
}

function loaded(pipe: AutomaticSpeechRecognitionPipeline, device: Device, webgpuError: string | null) {
  asr = pipe;
  self.postMessage({
    type: 'loaded',
    device,
    dtype: dtypeText(device),
    threads: device === 'wasm' ? threads : null,
    crossOriginIsolated: self.crossOriginIsolated,
    webgpuError,
  });
}

async function transcribe(id: number, audio: Float32Array, timestamps?: 'word') {
  if (!asr) throw new Error('model not loaded');
  const start = performance.now();
  if (timestamps) {
    // Audio past 30 s needs chunking; word times come from the cross-attention alignment.
    const out = (await asr(audio, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 })) as {
      text: string;
      chunks?: { text: string; timestamp: [number, number | null] }[];
    };
    const words = (out.chunks ?? []).map((c) => ({ text: c.text, start: c.timestamp[0], end: c.timestamp[1] }));
    self.postMessage({ type: 'done', id, ms: performance.now() - start, words: words.length, wordTimes: words });
    return;
  }
  const out = (await asr(audio)) as { text: string };
  const words = out.text.trim() ? out.text.trim().split(/\s+/).length : 0;
  self.postMessage({ type: 'done', id, ms: performance.now() - start, words });
}

// Fetches one small file the way the model loader would, from inside the worker.
async function probe(url: string) {
  const start = performance.now();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const bytes = (await res.arrayBuffer()).byteLength;
    self.postMessage({ type: 'probed', text: `HTTP ${res.status} ${res.statusText}, ${bytes} bytes, ${Math.round(performance.now() - start)} ms, from ${res.url}` });
  } catch (error) {
    self.postMessage({ type: 'probed', text: `error: ${errorMessage(error)}` });
  }
}

async function handle(msg: InMessage) {
  try {
    if (msg.type === 'load') await load(msg.model, msg.device);
    else if (msg.type === 'transcribe') await transcribe(msg.id, msg.audio, msg.timestamps);
    else if (msg.type === 'probe') await probe(msg.url);
    else if (msg.type === 'dispose') {
      await asr?.dispose();
      asr = null;
      self.postMessage({ type: 'disposed' });
    }
  } catch (error) {
    console.error('Klipkord: could not run Whisper', error);
    self.postMessage({ type: 'error', message: errorMessage(error) });
  }
}

// One message at a time, so answers come back in the order asked.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<InMessage>) => {
  queue = queue.then(() => handle(event.data));
};
