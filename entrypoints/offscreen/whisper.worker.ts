import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

// The package exports no path to its wasm file.
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

const errorMessage = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

// A failure outside a handled request still reaches the page.
self.addEventListener('unhandledrejection', (event) => {
  self.postMessage({ type: 'error', message: `Whisper worker: ${errorMessage(event.reason)}` });
});

// Extension pages may not load remote code, so ONNX Runtime's wasm ships inside the extension.
env.backends.onnx.wasm!.wasmPaths = { wasm: ortWasmUrl };
env.allowLocalModels = false;
// Not cross-origin isolated (no COEP/COOP), so ONNX Runtime runs one wasm thread.
env.backends.onnx.wasm!.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, self.navigator.hardwareConcurrency || 1)) : 1;

type Device = 'webgpu' | 'wasm';
// Quantized weights keep the CPU path fast; WebGPU keeps a full-precision encoder.
const DTYPES: Record<Device, Record<string, string>> = {
  webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' },
};

type Request =
  | { id: number; type: 'load'; model: string }
  | { id: number; type: 'transcribe'; audio: Float32Array; language: string; words?: boolean }
  | { id: number; type: 'dispose' };

interface Progress { status: string; file?: string; loaded?: number; total?: number }

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loaded: { model: string; device: Device } | null = null;

async function create(model: string, device: Device) {
  // Cast keeps tsc from expanding the pipeline's task overloads.
  const make = pipeline as (task: string, model: string, options: object) => Promise<unknown>;
  return (await make('automatic-speech-recognition', model, {
    device,
    dtype: DTYPES[device],
    progress_callback: (p: Progress) => {
      if (!p.file) return;
      self.postMessage({ type: 'progress', model, status: p.status, file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
    },
  })) as AutomaticSpeechRecognitionPipeline;
}

async function load(model: string): Promise<Device> {
  if (loaded?.model === model && asr) return loaded.device;
  await asr?.dispose();
  asr = null;
  loaded = null;
  const nav = self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  // navigator.gpu can exist with no usable adapter, so ask for one before trying WebGPU.
  const adapter = await nav.gpu?.requestAdapter().catch(() => null);
  let device: Device = 'wasm';
  if (adapter) {
    try {
      asr = await create(model, 'webgpu');
      device = 'webgpu';
    } catch (error) {
      console.error('Klipkord: could not load Whisper on WebGPU', error);
    }
  }
  asr ??= await create(model, 'wasm');
  loaded = { model, device };
  return device;
}

interface Word { start: number; end: number; text: string }
interface Output { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }

async function transcribe(audio: Float32Array, language: string, words: boolean): Promise<{ text: string; words?: Word[] }> {
  if (!asr) throw new Error('model not loaded');
  const multilingual = !loaded?.model.replace('_timestamped', '').endsWith('.en');
  const options = multilingual && language !== 'auto' ? { language, task: 'transcribe' } : {};
  // Chunks are about 10 s, under Whisper's 30 s window, so no chunk_length_s is needed.
  const out = (await asr(audio, words ? { ...options, return_timestamps: 'word' } : options)) as Output;
  if (!words) return { text: out.text.trim() };
  const list = (out.chunks ?? []).map((c) => {
    const start = Math.round(c.timestamp[0] * 1000);
    return { start, end: c.timestamp[1] === null ? start : Math.round(c.timestamp[1] * 1000), text: c.text.trim() };
  });
  return { text: out.text.trim(), words: list };
}

async function handle(msg: Request) {
  try {
    if (msg.type === 'load') self.postMessage({ type: 'loaded', id: msg.id, device: await load(msg.model) });
    else if (msg.type === 'transcribe') self.postMessage({ type: 'text', id: msg.id, ...(await transcribe(msg.audio, msg.language, Boolean(msg.words))) });
    else if (msg.type === 'dispose') {
      await asr?.dispose();
      asr = null;
      loaded = null;
      self.postMessage({ type: 'disposed', id: msg.id });
    }
  } catch (error) {
    console.error('Klipkord: could not run Whisper', error);
    self.postMessage({ type: 'error', id: msg.id, message: errorMessage(error) });
  }
}

// One request at a time, so chunks come back in the order sent.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<Request>) => {
  queue = queue.then(() => handle(event.data));
};
