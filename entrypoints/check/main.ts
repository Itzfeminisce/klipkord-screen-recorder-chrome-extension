import { TESTS, availabilityOf, emptyResults, errorText, failingTests, numberLines, resultsJson, withResult } from '@/lib/check/results';
import type { Results, Status, TestId, TestResult, Value } from '@/lib/check/results';
import { StoppedError, guard, pause } from '@/lib/check/guard';
import { frameStats, levelDb, mean, megabytes, realTimeFactor, round } from '@/lib/check/stats';
import { builtinAiNote, captureTarget, chromeMajor, soundStatus } from '@/lib/check/verdicts';

const HINTS: Record<TestId, string> = {
  mp4: 'Records 10 s of a test animation with a tone, once as MP4 and once as WebM. No prompts.',
  sound: 'Pick "Entire screen" and turn on "Also share system audio". Play a video with sound before you press Run.',
  composite: 'Pick "Entire screen" and allow the camera. Play a video on screen. Watch the live preview. Takes 60 s.',
  whisper:
    'Allow the microphone and talk or play speech for 2 minutes. Downloads whisper-tiny, whisper-base and whisper-small. Press Skip if whisper-small is too slow.',
  builtinAi: 'Asks Chrome whether Summarizer and LanguageModel are available. No prompts.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stopStream = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());

let results: Results;

// The one test that is running, with its Stop and optional Skip.
interface Run {
  id: TestId;
  signal: AbortSignal;
  numbers: Record<string, Value>;
  setSkip: (label: string | null, skip?: () => void) => void;
}
let active: { id: TestId; ctl: AbortController; skipLabel: string | null; skip?: () => void } | null = null;

function setStatus(text: string) {
  $('status').textContent = text;
}

function button(text: string, onClick: () => void, disabled = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function render() {
  const rows = $('rows');
  rows.replaceChildren();
  for (const t of TESTS) {
    const r = results.tests[t.id];
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = t.name;
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = HINTS[t.id];
    name.append(hint);
    const run = document.createElement('td');
    if (active?.id === t.id) {
      const ctl = active.ctl;
      run.append(button('Stop', () => ctl.abort()));
      if (active.skipLabel && active.skip) run.append(' ', button(active.skipLabel, active.skip));
    } else {
      run.append(button(r.status === 'not run' ? 'Run' : 'Run again', () => void runTest(t.id), active !== null));
    }
    const status = document.createElement('td');
    status.textContent = r.status;
    status.className = r.status.replace(' ', '-');
    const lines = document.createElement('td');
    lines.className = 'lines';
    const earlier = r.earlier?.length ? [`(${r.earlier.length} earlier run${r.earlier.length > 1 ? 's' : ''} kept in the copied results)`] : [];
    lines.textContent = [...numberLines(r), ...earlier].join('\n');
    tr.append(name, run, status, lines);
    rows.append(tr);
  }
  const failing = failingTests(results);
  const again = $<HTMLButtonElement>('rerun');
  again.disabled = active !== null || failing.length === 0;
  again.textContent = failing.length ? `Run failing tests again (${failing.length})` : 'Run failing tests again';
  const machine = $('machine');
  machine.replaceChildren();
  for (const [k, v] of Object.entries(results.machine)) {
    const tr = document.createElement('tr');
    const a = document.createElement('th');
    a.textContent = k;
    const b = document.createElement('td');
    b.textContent = String(v);
    tr.append(a, b);
    machine.append(tr);
  }
}

function update(id: TestId, result: TestResult) {
  results = withResult(results, id, result, new Date());
  render();
}

const RUNNERS: Record<TestId, (run: Run) => Promise<Status | void>> = {
  mp4: testMp4,
  sound: testSound,
  composite: testComposite,
  whisper: testWhisper,
  builtinAi: testBuiltinAi,
};

// Resolves false when the owner pressed Stop.
async function runTest(id: TestId): Promise<boolean> {
  if (active) return false;
  const ctl = new AbortController();
  active = { id, ctl, skipLabel: null };
  const run: Run = {
    id,
    signal: ctl.signal,
    numbers: {},
    setSkip: (label, skip) => {
      if (active?.ctl !== ctl) return;
      active.skipLabel = label;
      active.skip = skip;
      render();
    },
  };
  update(id, { status: 'running', numbers: {} });
  let stopped = false;
  try {
    const status = (await RUNNERS[id](run)) ?? 'pass';
    active = null;
    update(id, { status, numbers: run.numbers, ranAt: new Date().toISOString() });
    setStatus(status === 'pass' ? 'Done.' : 'Done, with a warning. See the numbers.');
  } catch (error) {
    stopped = error instanceof StoppedError;
    if (!stopped) console.error(`Klipkord: could not run check ${id}`, error);
    active = null;
    update(id, { status: 'fail', numbers: run.numbers, error: errorText(error), ranAt: new Date().toISOString() });
    setStatus(stopped ? 'Stopped.' : 'Test failed. The error is in the table.');
  }
  return !stopped;
}

async function rerunFailing() {
  for (const id of failingTests(results)) {
    if (!(await runTest(id))) return;
  }
}

async function machineInfo(): Promise<Record<string, Value>> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { platform: string; getHighEntropyValues(h: string[]): Promise<Record<string, unknown>> };
    gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> };
  };
  const info: Record<string, Value> = {
    userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency ?? null,
    memoryGb: nav.deviceMemory ?? null,
    screen: `${screen.width}x${screen.height} @${devicePixelRatio}x`,
    chrome: /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? null,
  };
  try {
    if (nav.userAgentData) {
      const h = await nav.userAgentData.getHighEntropyValues(['platformVersion', 'fullVersionList']);
      info.platform = `${nav.userAgentData.platform} ${String(h.platformVersion ?? '')}`.trim();
      const list = (h.fullVersionList as { brand: string; version: string }[] | undefined) ?? [];
      const brand = list.find((b) => b.brand === 'Google Chrome') ?? list.find((b) => b.brand === 'Chromium');
      if (brand) info.chrome = brand.version;
    }
  } catch (error) {
    console.error('Klipkord: could not read platform details', error);
  }
  try {
    const adapter = nav.gpu ? await nav.gpu.requestAdapter() : null;
    info.webgpu = adapter ? 'yes' : 'no';
    if (adapter?.info) info.gpu = `${adapter.info.vendor ?? ''} ${adapter.info.architecture ?? ''} ${adapter.info.description ?? ''}`.trim() || null;
  } catch (error) {
    info.webgpu = `error: ${errorText(error)}`;
  }
  return info;
}

// --- 1. MP4 ---

const TYPES = {
  mp4H264Aac: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  mp4H264AacHigh: 'video/mp4;codecs=avc1.640028,mp4a.40.2',
  mp4Plain: 'video/mp4',
  webmVp9Opus: 'video/webm;codecs=vp9,opus',
  webmVp8Opus: 'video/webm;codecs=vp8,opus',
};

function animatedSource(): { stream: MediaStream; stop: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;
  let frame = 0;
  const timer = setInterval(() => {
    frame++;
    ctx.fillStyle = `hsl(${frame % 360} 60% 40%)`;
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = '#fff';
    ctx.font = '64px sans-serif';
    ctx.fillText(`Klipkord ${frame}`, 100 + (frame % 600), 360);
  }, 1000 / 30);
  const audio = new AudioContext();
  const osc = audio.createOscillator();
  osc.frequency.value = 440;
  const dest = audio.createMediaStreamDestination();
  osc.connect(dest);
  osc.start();
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  return {
    stream,
    stop: () => {
      clearInterval(timer);
      osc.stop();
      void audio.close();
      stopStream(stream);
    },
  };
}

function startRecorder(recorder: MediaRecorder, onData: (b: Blob) => void) {
  recorder.ondataavailable = (e) => e.data.size && onData(e.data);
  const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));
  recorder.start(1000);
  // Waits for the last chunk, but never hangs if the recorder does not answer.
  return async () => {
    if (recorder.state !== 'inactive') recorder.stop();
    await guard(stopped, { ms: 5000, what: 'MediaRecorder stop' });
  };
}

async function record(stream: MediaStream, mimeType: string, ms: number, signal: AbortSignal): Promise<{ bytes: number; type: string }> {
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  const stop = startRecorder(recorder, (b) => chunks.push(b));
  try {
    await pause(ms, signal);
  } finally {
    await stop().catch(() => undefined);
  }
  const blob = new Blob(chunks, { type: recorder.mimeType });
  return { bytes: blob.size, type: recorder.mimeType };
}

async function testMp4({ numbers, signal }: Run) {
  for (const [k, t] of Object.entries(TYPES)) numbers[`supported.${k}`] = MediaRecorder.isTypeSupported(t);
  const mp4 = [TYPES.mp4H264Aac, TYPES.mp4H264AacHigh, TYPES.mp4Plain].find((t) => MediaRecorder.isTypeSupported(t));
  const src = animatedSource();
  try {
    if (mp4) {
      setStatus('Recording 10 s as MP4...');
      const r = await record(src.stream, mp4, 10_000, signal);
      numbers['mp4.requested'] = mp4;
      numbers['mp4.type'] = r.type;
      numbers['mp4.bytes'] = r.bytes;
    } else {
      numbers['mp4.requested'] = null;
    }
    if (MediaRecorder.isTypeSupported(TYPES.webmVp9Opus)) {
      setStatus('Recording 10 s as WebM...');
      const r = await record(src.stream, TYPES.webmVp9Opus, 10_000, signal);
      numbers['webm.type'] = r.type;
      numbers['webm.bytes'] = r.bytes;
    }
  } finally {
    src.stop();
  }
}

// --- 2 and 3. Screen capture ---

// desktopCapture runs in this extension page, and the stream id is consumed right here.
async function chooseScreen(
  sources: `${chrome.desktopCapture.DesktopCaptureSourceType}`[],
  signal: AbortSignal,
): Promise<{ id: string; canRequestAudioTrack: boolean }> {
  let requestId: number | undefined;
  const picked = new Promise<{ id: string; canRequestAudioTrack: boolean }>((resolve, reject) => {
    requestId = chrome.desktopCapture.chooseDesktopMedia(sources as chrome.desktopCapture.DesktopCaptureSourceType[], (id, options) => {
      if (!id) reject(new Error('Screen picker was cancelled'));
      else resolve({ id, canRequestAudioTrack: Boolean(options?.canRequestAudioTrack) });
    });
  });
  try {
    return await guard(picked, { ms: 120_000, what: 'Screen picker', signal });
  } catch (error) {
    if (requestId !== undefined) chrome.desktopCapture.cancelChooseDesktopMedia(requestId);
    throw error;
  }
}

function desktopStream(id: string, audio: boolean, signal: AbortSignal): Promise<MediaStream> {
  const source = { chromeMediaSource: 'desktop', chromeMediaSourceId: id };
  const stream = navigator.mediaDevices.getUserMedia({
    audio: audio ? ({ mandatory: source } as MediaTrackConstraints) : false,
    video: { mandatory: { ...source, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 } } as MediaTrackConstraints,
  });
  return guard(stream, { ms: 30_000, what: 'Screen capture', signal, dispose: stopStream });
}

async function testSound({ numbers, signal }: Run): Promise<Status> {
  const pick = await chooseScreen(['screen', 'window', 'tab', 'audio'], signal);
  const stream = await desktopStream(pick.id, true, signal);
  const track = stream.getAudioTracks()[0];
  numbers.canRequestAudioTrack = pick.canRequestAudioTrack;
  numbers.audioTrack = Boolean(track);
  numbers.audioTrackLabel = track?.label ?? null;
  const ctx = new AudioContext();
  try {
    if (!track) return 'fail';
    setStatus('Listening for 10 s. Keep the video with sound playing...');
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const levels: number[] = [];
    let silent = 0;
    for (let i = 0; i < 100; i++) {
      await pause(100, signal);
      analyser.getFloatTimeDomainData(buf);
      const db = levelDb(buf);
      if (db === null) silent++;
      else levels.push(db);
    }
    const peak = levels.length ? Math.max(...levels) : null;
    numbers.peakLevelDb = peak;
    numbers.meanLevelDb = levels.length ? round(mean(levels)) : null;
    numbers.silentSamples = `${silent}/100`;
    const status = soundStatus(peak);
    if (status === 'warn') numbers.note = 'too quiet: play a video with sound before you press Run';
    return status;
  } finally {
    void ctx.close();
    stopStream(stream);
  }
}

// Videos stay in the page as small previews; Chrome only delivers frames to attached, visible videos.
async function playing(stream: MediaStream, label: string, signal: AbortSignal): Promise<HTMLVideoElement> {
  const figure = document.createElement('figure');
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  const caption = document.createElement('figcaption');
  caption.textContent = label;
  figure.append(video, caption);
  $('sources').append(figure);
  await guard(video.play(), { ms: 10_000, what: `${label} video`, signal });
  return video;
}

function trackFrames(video: HTMLVideoElement, times: number[], until: () => boolean) {
  const cb = (now: number) => {
    times.push(now);
    if (!until()) video.requestVideoFrameCallback(cb);
  };
  video.requestVideoFrameCallback(cb);
}

async function testComposite({ numbers, signal }: Run) {
  const pick = await chooseScreen(['screen', 'window'], signal);
  const streams: MediaStream[] = [];
  const preview = $('preview');
  const out = $<HTMLCanvasElement>('composite');
  let done = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopRecorder: (() => Promise<void>) | undefined;
  try {
    const screenStream = await desktopStream(pick.id, false, signal);
    streams.push(screenStream);
    setStatus('Waiting for the camera. Allow it if Chrome asks...');
    const cameraStream = await guard(navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 } }), {
      ms: 60_000,
      what: 'Camera',
      signal,
      dispose: stopStream,
    });
    streams.push(cameraStream);

    const real = { width: Math.round(screen.width * devicePixelRatio), height: Math.round(screen.height * devicePixelRatio) };
    const { width: W, height: H } = captureTarget(real);
    const capture = screenStream.getVideoTracks()[0]?.getSettings();
    numbers.requestedSize = '1920x1080';
    numbers.screenSize = `${real.width}x${real.height}`;
    numbers.targetSize = `${W}x${H}`;
    numbers.captureSize = capture?.width ? `${capture.width}x${capture.height}` : null;

    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d', { alpha: false })!;
    preview.hidden = false;
    preview.scrollIntoView({ block: 'start' });
    setStatus('Starting the preview...');
    const screenVideo = await playing(screenStream, 'Screen', signal);
    const cameraVideo = await playing(cameraStream, 'Camera', signal);

    const drawMs: number[] = [];
    const bubble = Math.round(H * 0.26);
    const margin = Math.round(H * 0.037);
    let drawError: string | null = null;
    const draw = () => {
      if (done) return;
      const t0 = performance.now();
      try {
        ctx.drawImage(screenVideo, 0, 0, W, H);
        ctx.save();
        ctx.beginPath();
        ctx.arc(W - bubble / 2 - margin, H - bubble / 2 - margin, bubble / 2, 0, Math.PI * 2);
        ctx.clip();
        const side = Math.min(cameraVideo.videoWidth, cameraVideo.videoHeight) || 1;
        ctx.drawImage(
          cameraVideo,
          (cameraVideo.videoWidth - side) / 2,
          (cameraVideo.videoHeight - side) / 2,
          side,
          side,
          W - bubble - margin,
          H - bubble - margin,
          bubble,
          bubble,
        );
        ctx.restore();
      } catch (error) {
        drawError ??= errorText(error);
      }
      drawMs.push(performance.now() - t0);
    };
    // A steady 30 fps clock; screen frames only arrive when the screen changes. Drawing starts before the
    // output video plays, because a canvas stream has no frame to play until something is drawn.
    timer = setInterval(draw, 1000 / 30);
    draw();
    const outStream = out.captureStream(30);
    streams.push(outStream);
    const outVideo = await playing(outStream, 'Recorded stream', signal);

    const screenTimes: number[] = [];
    const outTimes: number[] = [];
    trackFrames(screenVideo, screenTimes, () => done);
    trackFrames(outVideo, outTimes, () => done);
    const recorderType = MediaRecorder.isTypeSupported(TYPES.mp4H264Aac) ? 'video/mp4;codecs=avc1.42E01E' : 'video/webm;codecs=vp9';
    const recorder = new MediaRecorder(outStream, { mimeType: recorderType, videoBitsPerSecond: 8_000_000 });
    let bytes = 0;
    stopRecorder = startRecorder(recorder, (b) => (bytes += b.size));

    for (let s = 60; s > 0; s--) {
      setStatus(`Compositing and recording at ${W}x${H}... ${s} s left`);
      await pause(1000, signal);
    }
    done = true;
    clearInterval(timer);
    await stopRecorder();
    stopRecorder = undefined;

    const outStats = frameStats(outTimes, 30);
    const screenStats = frameStats(screenTimes, 30);
    numbers.screenFrames = screenStats.frames;
    numbers.screenMeanFps = screenStats.meanFps;
    numbers.outputFrames = outStats.frames;
    numbers.outputMeanFps = outStats.meanFps;
    numbers.outputDroppedFrames = outStats.droppedFrames;
    numbers.meanDrawMs = round(mean(drawMs), 2);
    numbers.maxDrawMs = round(Math.max(0, ...drawMs), 2);
    numbers.drawError = drawError;
    numbers.recorderType = recorder.mimeType;
    numbers.recordedMb = megabytes(bytes);
  } finally {
    done = true;
    clearInterval(timer);
    await stopRecorder?.().catch(() => undefined);
    streams.forEach(stopStream);
    $('sources').replaceChildren();
    preview.hidden = true;
  }
}

// --- 4. Whisper ---

const SAMPLE_RATE = 16_000;
const CHUNK_S = 10;
const CHUNKS = 12;
const MINUTE = 60_000;

class WhisperWorker {
  private worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  private waiting: { resolve: (m: Record<string, unknown>) => void; reject: (e: Error) => void }[] = [];

  constructor() {
    this.worker.onmessage = (e: MessageEvent<Record<string, unknown>>) => {
      const w = this.waiting.shift();
      if (e.data.type === 'error') w?.reject(new Error(String(e.data.message)));
      else w?.resolve(e.data);
    };
    this.worker.onerror = (e) => this.failAll(new Error(`Whisper worker: ${e.message || 'could not start'}`));
  }

  private failAll(error: Error) {
    for (const w of this.waiting.splice(0)) w.reject(error);
  }

  // The worker answers each message once, in order.
  send(msg: unknown, opts: { ms: number; what: string; signal: AbortSignal }, transfer: Transferable[] = []) {
    const answer = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.worker.postMessage(msg, transfer);
    });
    return guard(answer, opts);
  }

  terminate() {
    this.worker.terminate();
    this.failAll(new StoppedError());
  }
}

async function recordMic(onChunk: (chunk: Float32Array, index: number) => void, signal: AbortSignal): Promise<void> {
  const stream = await guard(navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }), {
    ms: MINUTE,
    what: 'Microphone',
    signal,
    dispose: stopStream,
  });
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor keeps this check to one file; T1 can move to an AudioWorklet.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const size = SAMPLE_RATE * CHUNK_S;
  let buf = new Float32Array(size);
  let fill = 0;
  let index = 0;
  try {
    await guard(ctx.resume(), { ms: 10_000, what: 'Audio', signal });
    const full = new Promise<void>((resolve) => {
      node.onaudioprocess = (e) => {
        if (index >= CHUNKS) return;
        const input = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
          buf[fill++] = input[i]!;
          if (fill === size) {
            onChunk(buf, index++);
            buf = new Float32Array(size);
            fill = 0;
            if (index >= CHUNKS) {
              resolve();
              return;
            }
          }
        }
      };
      source.connect(node);
      node.connect(ctx.destination);
    });
    await guard(full, { ms: (CHUNK_S * CHUNKS + 30) * 1000, what: 'Microphone recording', signal });
  } finally {
    node.disconnect();
    source.disconnect();
    stopStream(stream);
    void ctx.close();
  }
}

async function loadModel(worker: WhisperWorker, model: string, key: string, run: Run, signal = run.signal) {
  setStatus(`Loading ${model} (first run downloads it)...`);
  const m = await worker.send({ type: 'load', model: `onnx-community/${model}` }, { ms: 15 * MINUTE, what: `Loading ${model}`, signal });
  const n = run.numbers;
  n[`${key}.model`] = `onnx-community/${model}`;
  n[`${key}.device`] = String(m.device);
  n[`${key}.dtype`] = String(m.dtype);
  n[`${key}.wasmThreads`] = (m.threads as number | null) ?? null;
  n[`${key}.crossOriginIsolated`] = Boolean(m.crossOriginIsolated);
  n[`${key}.webgpuError`] = (m.webgpuError as string | null) ?? null;
  n[`${key}.downloadMb`] = megabytes(Number(m.downloadBytes));
  n[`${key}.loadS`] = round(Number(m.loadMs) / 1000);
}

function chunkStats(ms: number[], words: number[], numbers: Record<string, Value>, key: string) {
  numbers[`${key}.chunks`] = ms.length;
  if (!ms.length) return;
  numbers[`${key}.meanChunkMs`] = Math.round(mean(ms));
  numbers[`${key}.realTimeFactor`] = realTimeFactor(mean(ms), CHUNK_S * 1000);
  numbers[`${key}.worstRealTimeFactor`] = realTimeFactor(Math.max(0, ...ms), CHUNK_S * 1000);
  numbers[`${key}.words`] = words.reduce((a, b) => a + b, 0);
}

// Runs a loaded model over the saved chunks one by one.
async function transcribeAll(worker: WhisperWorker, model: string, key: string, chunks: Float32Array[], run: Run, signal: AbortSignal) {
  const ms: number[] = [];
  const words: number[] = [];
  try {
    for (const [i, chunk] of chunks.entries()) {
      setStatus(`${model}: chunk ${i + 1} of ${chunks.length}...`);
      const m = await worker.send({ type: 'transcribe', id: i, audio: chunk.slice() }, { ms: 5 * MINUTE, what: `${model} chunk ${i + 1}`, signal });
      ms.push(Number(m.ms));
      words.push(Number(m.words));
    }
  } finally {
    chunkStats(ms, words, run.numbers, key);
  }
}

async function testWhisper(run: Run) {
  const { numbers, signal } = run;
  numbers.chunkS = CHUNK_S;
  numbers.audioS = CHUNK_S * CHUNKS;
  numbers.cores = navigator.hardwareConcurrency ?? null;
  const worker = new WhisperWorker();
  try {
    // whisper-tiny transcribes live while the mic records; base and small then run on the same chunks.
    await loadModel(worker, 'whisper-tiny', 'tiny', run);
    const chunks: Float32Array[] = [];
    const pending: Promise<Record<string, unknown>>[] = [];
    setStatus('Recording 2 minutes from the microphone. Talk or play speech...');
    await recordMic((chunk, i) => {
      chunks.push(chunk);
      setStatus(`Recording... chunk ${i + 1} of ${CHUNKS}`);
      const answer = worker.send({ type: 'transcribe', id: i, audio: chunk.slice() }, { ms: 15 * MINUTE, what: `whisper-tiny chunk ${i + 1}`, signal });
      // A stop rejects every queued chunk; Promise.all below reports the first one.
      answer.catch(() => undefined);
      pending.push(answer);
    }, signal);
    setStatus('Finishing whisper-tiny...');
    const tinyDone = await Promise.all(pending);
    chunkStats(
      tinyDone.map((m) => Number(m.ms)),
      tinyDone.map((m) => Number(m.words)),
      numbers,
      'tiny',
    );
    await worker.send({ type: 'dispose' }, { ms: MINUTE, what: 'Unloading whisper-tiny', signal });

    await loadModel(worker, 'whisper-base', 'base', run);
    await transcribeAll(worker, 'whisper-base', 'base', chunks, run, signal);
    await worker.send({ type: 'dispose' }, { ms: MINUTE, what: 'Unloading whisper-base', signal });

    // whisper-small can be very slow on a CPU, so the owner may skip it and keep the rest.
    const skip = new AbortController();
    run.setSkip('Skip whisper-small', () => skip.abort());
    const smallSignal = AbortSignal.any([signal, skip.signal]);
    try {
      await loadModel(worker, 'whisper-small', 'small', run, smallSignal);
      await transcribeAll(worker, 'whisper-small', 'small', chunks, run, smallSignal);
      numbers['small.skipped'] = false;
    } catch (error) {
      if (!(error instanceof StoppedError) || signal.aborted) throw error;
      numbers['small.skipped'] = true;
    } finally {
      run.setSkip(null);
    }
  } finally {
    worker.terminate();
  }
}

// --- 5. Built-in AI ---

async function testBuiltinAi({ numbers }: Run): Promise<Status> {
  const g = globalThis as unknown as Record<string, { availability?: () => Promise<unknown> } | undefined>;
  const version = typeof results.machine.chrome === 'string' ? results.machine.chrome : navigator.userAgent;
  numbers.chrome = typeof results.machine.chrome === 'string' ? results.machine.chrome : (/Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? null);
  const found: string[] = [];
  for (const name of ['Summarizer', 'LanguageModel']) {
    try {
      const a = availabilityOf(await guard(g[name]?.availability?.() ?? Promise.resolve(undefined), { ms: 30_000, what: name }));
      numbers[name] = a;
      found.push(a);
    } catch (error) {
      console.error(`Klipkord: could not check ${name}`, error);
      numbers[name] = `error: ${errorText(error)}`;
    }
  }
  const note = builtinAiNote(chromeMajor(version), found);
  if (note) numbers.note = note;
  return note ? 'warn' : 'pass';
}

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(resultsJson(results));
    setStatus('Results copied.');
  } catch (error) {
    console.error('Klipkord: could not copy results', error);
    setStatus('Could not copy. Select the table text instead.');
  }
});
$('rerun').addEventListener('click', () => void rerunFailing());

results = emptyResults({}, new Date());
render();
void machineInfo().then((machine) => {
  results = { ...results, machine };
  render();
});
