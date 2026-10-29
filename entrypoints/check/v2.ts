import { StoppedError, guard } from '@/lib/check/guard';
import { errorText } from '@/lib/check/results';
import type { Value } from '@/lib/check/results';
import { megabytes, realTimeFactor, round } from '@/lib/check/stats';
import { checkWordTimes, gifFramePlan, wordLine } from '@/lib/check/v2';
import type { WordTime } from '@/lib/check/v2';
import { WhisperWorker } from './whisper-client';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stopStream = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());
const MINUTE = 60_000;
const SAMPLE_RATE = 16_000;
const CLIP_S = 60;
// v1's numbers on the owner's laptop, shown next to the new ones.
const V1_RTF = { tiny: 0.29, base: 0.49 };
const DRAW_URL = 'https://huggingface.co/';

type Probe = 'bubble' | 'words' | 'draw' | 'gif';
const v2: Record<Probe, Record<string, Value>> = { bubble: {}, words: {}, draw: {}, gif: {} };

function show(probe: Probe) {
  $(`v2-${probe}-numbers`).textContent = Object.entries(v2[probe])
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}
function say(probe: Probe, text: string) {
  $(`v2-${probe}-status`).textContent = text;
}
function fail(probe: Probe, what: string, error: unknown) {
  console.error(`Klipkord: could not ${what}`, error);
  v2[probe].error = errorText(error);
  say(probe, `Failed: ${errorText(error)}`);
  show(probe);
}

// ---- 1. Floating bubble ----

interface DocumentPip {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}
const docPip = () => (window as Window & { documentPictureInPicture?: DocumentPip }).documentPictureInPicture;

function bubbleAvailability() {
  v2.bubble.documentPictureInPicture = Boolean(docPip());
  v2.bubble.videoPictureInPicture = Boolean(document.pictureInPictureEnabled);
  show('bubble');
}

async function camera(): Promise<MediaStream> {
  return guard(navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 640 }, audio: false }), {
    ms: MINUTE,
    what: 'Camera',
    dispose: stopStream,
  });
}

async function openDocBubble() {
  const pip = docPip();
  if (!pip) return say('bubble', 'Document Picture-in-Picture is not available in this Chrome. Try the video fallback.');
  try {
    // requestWindow needs the click's user activation, so it runs before the camera prompt.
    const win = await pip.requestWindow({ width: 240, height: 240 });
    const stream = await camera();
    const d = win.document;
    d.body.style.cssText = 'margin:0;background:transparent;display:grid;place-items:center;height:100vh;overflow:hidden';
    const video = d.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.style.cssText = 'width:92vmin;height:92vmin;border-radius:50%;object-fit:cover;transform:scaleX(-1);border:3px solid #fff';
    d.body.append(video);
    const opened = performance.now();
    win.addEventListener('pagehide', () => {
      stopStream(stream);
      v2.bubble.docPipOpenS = round((performance.now() - opened) / 1000);
      say('bubble', 'Bubble closed.');
      show('bubble');
    });
    v2.bubble.docPipOpened = true;
    v2.bubble.docPipSize = `${win.innerWidth}x${win.innerHeight}`;
    say('bubble', 'Bubble open. Drag it, switch to another app, close the side panel, then capture it. Note the answers below.');
    show('bubble');
  } catch (error) {
    v2.bubble.docPipOpened = false;
    fail('bubble', 'open the Document Picture-in-Picture bubble', error);
  }
}

async function openVideoBubble() {
  try {
    const stream = await camera();
    const video = $<HTMLVideoElement>('v2-bubble-video');
    video.srcObject = stream;
    await video.play();
    await video.requestPictureInPicture();
    video.addEventListener('leavepictureinpicture', () => stopStream(stream), { once: true });
    v2.bubble.videoPipOpened = true;
    say('bubble', 'Video Picture-in-Picture open (square). Check it the same way and note the answers below.');
    show('bubble');
  } catch (error) {
    v2.bubble.videoPipOpened = false;
    fail('bubble', 'open the video Picture-in-Picture bubble', error);
  }
}

const QUESTIONS: [string, string][] = [
  ['onTopOfOtherApps', 'Stays above other apps (not only Chrome)'],
  ['canDrag', 'Can be dragged'],
  ['survivesSidePanelClose', 'Stays open when the side panel closes'],
  ['inWindowCapture', 'Shows in a window capture'],
  ['inScreenCapture', 'Shows in an entire-screen capture'],
];

function bubbleQuestions() {
  const box = $('v2-bubble-answers');
  for (const [key, label] of QUESTIONS) {
    const row = document.createElement('label');
    row.style.cssText = 'display:block;margin:2px 0';
    const select = document.createElement('select');
    for (const opt of ['not tried', 'doc PiP: yes', 'doc PiP: no', 'video PiP only: yes', 'neither']) {
      select.append(new Option(opt, opt));
    }
    select.addEventListener('change', () => {
      v2.bubble[key] = select.value;
      show('bubble');
    });
    row.append(select, ` ${label}`);
    box.append(row);
  }
}

// ---- 2. Word timings ----

let wordsCtl: AbortController | null = null;

async function recordClip(signal: AbortSignal): Promise<Float32Array> {
  const stream = await guard(navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }), {
    ms: MINUTE,
    what: 'Microphone',
    signal,
    dispose: stopStream,
  });
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(stream);
  // Same ScriptProcessor path as v1's Whisper test, one 60 s buffer.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const clip = new Float32Array(SAMPLE_RATE * CLIP_S);
  let fill = 0;
  try {
    await ctx.resume();
    const full = new Promise<void>((resolve) => {
      node.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const n = Math.min(input.length, clip.length - fill);
        clip.set(input.subarray(0, n), fill);
        fill += n;
        if (fill % (SAMPLE_RATE * 5) < 4096) say('words', `Recording... ${Math.floor(fill / SAMPLE_RATE)} of ${CLIP_S} s`);
        if (fill >= clip.length) resolve();
      };
      source.connect(node);
      node.connect(ctx.destination);
    });
    await guard(full, { ms: (CLIP_S + 30) * 1000, what: 'Microphone recording', signal });
    return clip;
  } finally {
    node.disconnect();
    source.disconnect();
    stopStream(stream);
    void ctx.close().catch(() => undefined);
  }
}

async function fileClip(file: File): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    return audio.getChannelData(0).slice(0, SAMPLE_RATE * CLIP_S);
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

// Word times need alignment heads; if the plain export lacks them, the _timestamped export is tried.
async function loadForWords(worker: WhisperWorker, model: string, signal: AbortSignal): Promise<string> {
  let lastError: unknown;
  for (const id of [`onnx-community/${model}`, `onnx-community/${model}_timestamped`]) {
    try {
      await worker.send({ type: 'load', model: id, device: 'wasm' }, { ms: 10 * MINUTE, what: `Loading ${id}`, signal });
      return id;
    } catch (error) {
      if (error instanceof StoppedError) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

async function wordsFor(worker: WhisperWorker, model: 'tiny' | 'base', clip: Float32Array, signal: AbortSignal) {
  const n = v2.words;
  const clipS = clip.length / SAMPLE_RATE;
  const start = performance.now();
  say('words', `Loading whisper-${model} (wasm, q8; cached after the first run)...`);
  n[`${model}.model`] = await loadForWords(worker, `whisper-${model}`, signal);
  n[`${model}.loadS`] = round((performance.now() - start) / 1000);
  const transcribe = () => {
    say('words', `whisper-${model}: transcribing ${round(clipS)} s with word times...`);
    return worker.send({ type: 'transcribe', id: 0, audio: clip.slice(), timestamps: 'word' }, { ms: 10 * MINUTE, what: `whisper-${model} words`, signal });
  };
  let m: Record<string, unknown>;
  try {
    m = await transcribe();
  } catch (error) {
    // The plain export can load yet fail at alignment; retry once with the _timestamped export.
    if (error instanceof StoppedError || String(n[`${model}.model`]).endsWith('_timestamped')) throw error;
    n[`${model}.plainError`] = errorText(error);
    const id = `onnx-community/whisper-${model}_timestamped`;
    await worker.send({ type: 'dispose' }, { ms: MINUTE, what: 'Unloading', signal });
    await worker.send({ type: 'load', model: id, device: 'wasm' }, { ms: 10 * MINUTE, what: `Loading ${id}`, signal });
    n[`${model}.model`] = id;
    m = await transcribe();
  }
  const words = m.wordTimes as WordTime[];
  const c = checkWordTimes(words, clipS);
  n[`${model}.ms`] = Math.round(Number(m.ms));
  n[`${model}.realTimeFactor`] = realTimeFactor(Number(m.ms), clipS * 1000);
  n[`${model}.v1RealTimeFactor`] = V1_RTF[model];
  n[`${model}.words`] = c.words;
  n[`${model}.missingTimes`] = c.missingTimes;
  n[`${model}.outOfOrder`] = c.outOfOrder;
  n[`${model}.pastClip`] = c.pastClip;
  n[`${model}.lastEndS`] = c.lastEndS;
  n[`${model}.firstWords`] = wordLine(words);
  show('words');
  await worker.send({ type: 'dispose' }, { ms: MINUTE, what: `Unloading whisper-${model}`, signal });
}

async function runWords() {
  if (wordsCtl) return;
  wordsCtl = new AbortController();
  const { signal } = wordsCtl;
  const worker = new WhisperWorker();
  signal.addEventListener('abort', () => worker.terminate());
  $<HTMLButtonElement>('v2-words-stop').disabled = false;
  v2.words = {};
  try {
    const file = $<HTMLInputElement>('v2-words-file').files?.[0];
    let clip: Float32Array;
    if (file) {
      say('words', `Decoding ${file.name}...`);
      clip = await fileClip(file);
      v2.words.source = 'file';
    } else {
      say('words', `Recording ${CLIP_S} s from the microphone. Talk or play speech...`);
      clip = await recordClip(signal);
      v2.words.source = 'microphone';
    }
    v2.words.clipS = round(clip.length / SAMPLE_RATE);
    v2.words.cores = navigator.hardwareConcurrency ?? null;
    show('words');
    await wordsFor(worker, 'tiny', clip, signal);
    await wordsFor(worker, 'base', clip, signal);
    say('words', 'Done. Read the first words against the clip and note whether the times look right.');
  } catch (error) {
    if (error instanceof StoppedError) say('words', 'Stopped.');
    else fail('words', 'run the word timings check', error);
  } finally {
    worker.terminate();
    wordsCtl = null;
    $<HTMLButtonElement>('v2-words-stop').disabled = true;
    show('words');
  }
}

// ---- 3. Draw ----

// Runs in the page: a full-window canvas that redraws a magenta stroke, like the draw tool will.
function drawOverlay() {
  document.getElementById('klipkord-draw-check')?.remove();
  const canvas = document.createElement('canvas');
  canvas.id = 'klipkord-draw-check';
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none';
  document.documentElement.append(canvas);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  let t = 0;
  const step = () => {
    if (!canvas.isConnected) return;
    t++;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = 40; x < innerWidth - 40; x += 8) {
      const y = innerHeight / 2 + Math.sin((x + t * 4) / 60) * 80;
      if (x === 40) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    requestAnimationFrame(step);
  };
  step();
}

async function injectDraw() {
  try {
    // The check page can't get activeTab, so it draws on a tab the extension already has host access to.
    const tab = await chrome.tabs.create({ url: DRAW_URL, active: true });
    await new Promise<void>((resolve) => {
      const listener = (id: number, info: { status?: string }) => {
        if (id !== tab.id || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: drawOverlay });
    v2.draw.injected = true;
    v2.draw.tab = DRAW_URL;
    say('draw', 'Stroke drawn on the new tab. Come back here and press Capture a tab, then pick that tab.');
    show('draw');
  } catch (error) {
    v2.draw.injected = false;
    fail('draw', 'draw on the test tab', error);
  }
}

function chooseTab(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(['tab', 'window', 'screen'] as chrome.desktopCapture.DesktopCaptureSourceType[], (id) =>
      id ? resolve(id) : reject(new Error('Picker was cancelled')),
    );
  });
}

async function captureDraw() {
  try {
    const id = await chooseTab();
    const source = { chromeMediaSource: 'desktop', chromeMediaSourceId: id };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { ...source, maxWidth: 1920, maxHeight: 1080 } } as MediaTrackConstraints });
    const video = $<HTMLVideoElement>('v2-draw-video');
    video.srcObject = stream;
    await video.play();
    // Let a few frames arrive so the overlay has painted into the capture.
    await new Promise((r) => setTimeout(r, 1000));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let magenta = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i]! > 200 && px[i + 1]! < 80 && px[i + 2]! > 200) magenta++;
    v2.draw.captureSize = `${canvas.width}x${canvas.height}`;
    v2.draw.magentaPixels = magenta;
    // A 16 px stroke across the page is thousands of pixels; a handful is noise.
    v2.draw.strokeInCapture = magenta > 2000;
    say('draw', v2.draw.strokeInCapture ? 'The stroke shows in the capture.' : 'No stroke found in the capture. Did you pick the test tab?');
    show('draw');
    setTimeout(() => stopStream(stream), 5000);
  } catch (error) {
    fail('draw', 'capture the drawn tab', error);
  }
}

// ---- 4. GIF ----

async function runGif() {
  const plan = gifFramePlan(15, 12, 640);
  v2.gif = { frames: plan.frames, size: `${plan.width}x${plan.height}`, delayMs: plan.delayMs, playedFps: plan.playedFps };
  show('gif');
  const worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
  try {
    const done = await guard(
      new Promise<Record<string, unknown>>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<Record<string, unknown>>) => {
          if (e.data.type === 'progress') say('gif', `Encoding frame ${e.data.frame} of ${plan.frames}...`);
          else if (e.data.type === 'error') reject(new Error(String(e.data.message)));
          else resolve(e.data);
        };
        worker.onerror = (e) => reject(new Error(e.message || 'GIF worker could not start'));
        worker.postMessage(plan);
      }),
      { ms: 10 * MINUTE, what: 'GIF encoding' },
    );
    v2.gif.seconds = round(Number(done.ms) / 1000);
    v2.gif.drawSeconds = round(Number(done.drawMs) / 1000);
    v2.gif.bytes = Number(done.bytes);
    v2.gif.megabytes = megabytes(Number(done.bytes));
    const url = URL.createObjectURL(new Blob([done.gif as ArrayBuffer], { type: 'image/gif' }));
    $<HTMLImageElement>('v2-gif-img').src = url;
    $<HTMLImageElement>('v2-gif-img').hidden = false;
    say('gif', 'Done. The GIF plays below.');
  } catch (error) {
    fail('gif', 'encode the GIF', error);
  } finally {
    worker.terminate();
    show('gif');
  }
}

// ---- Wiring ----

$('v2-bubble-doc').addEventListener('click', () => void openDocBubble());
$('v2-bubble-video-btn').addEventListener('click', () => void openVideoBubble());
$('v2-words-run').addEventListener('click', () => void runWords());
$('v2-words-stop').addEventListener('click', () => wordsCtl?.abort());
$('v2-draw-inject').addEventListener('click', () => void injectDraw());
$('v2-draw-capture').addEventListener('click', () => void captureDraw());
$('v2-gif-run').addEventListener('click', () => void runGif());
$('v2-copy').addEventListener('click', async () => {
  const text = JSON.stringify({ v2: { ...v2, chrome: navigator.userAgent }, at: new Date().toISOString() }, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    $('v2-copy-status').textContent = 'Copied.';
  } catch (error) {
    console.error('Klipkord: could not copy the v2 results', error);
    $('v2-copy-status').textContent = 'Could not copy; select the text below.';
    $('v2-copy-status').append(Object.assign(document.createElement('pre'), { textContent: text }));
  }
});
bubbleQuestions();
bubbleAvailability();
