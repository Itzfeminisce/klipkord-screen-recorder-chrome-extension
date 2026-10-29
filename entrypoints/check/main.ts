import { TESTS, availabilityOf, emptyResults, errorText, failingTests, numberLines, resultsJson, withResult } from '@/lib/check/results';
import type { Results, Status, TestId, TestResult, Value } from '@/lib/check/results';
import { StoppedError, TimeoutError, cleanupStack, guard, pause, watchdog } from '@/lib/check/guard';
import { downloadSummary, frameStats, levelDb, mean, megabytes, realTimeFactor, round } from '@/lib/check/stats';
import type { FileProgress } from '@/lib/check/stats';
import { builtinAiNote, captureTarget, chromeMajor, smallSkipNote, soundStatus } from '@/lib/check/verdicts';

const HINTS: Record<TestId, string> = {
  mp4: 'Records 10 s of a test animation with a tone, once as MP4 and once as WebM. No prompts.',
  sound: 'Pick "Entire screen" and turn on "Also share system audio". Play a video with sound before you press Run.',
  composite: 'Pick "Entire screen" and allow the camera. Play a video on screen. Watch the live preview. Takes 60 s.',
  whisper:
    'Downloads whisper-tiny, then allow the microphone and talk or play speech for 30 s. Then runs whisper-base, and whisper-small only if base is fast. Test model download only checks the model host in seconds.',
  builtinAi: 'Asks Chrome whether Summarizer and LanguageModel are available. No prompts.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stopStream = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());

let results: Results;

// Every test runs on its own: its own Stop, its own cleanups, no shared lock.
interface Run {
  id: TestId;
  signal: AbortSignal;
  numbers: Record<string, Value>;
  say: (text: string) => void;
  stage: (name: string) => void;
  // Registers something to undo when the test ends, is stopped or times out.
  cleanup: (fn: () => void) => void;
  // Registers a stream so its tracks (and the camera light) stop when the test ends.
  stream: (s: MediaStream) => MediaStream;
  setSkip: (label: string | null, skip?: () => void) => void;
}
interface Live {
  ctl: AbortController;
  skipLabel: string | null;
  skip?: () => void;
}
const live = new Map<TestId, Live>();
const LIMIT_MS: Record<TestId, number> = { mp4: 30_000, sound: 30_000, composite: 120_000, whisper: 10 * 60_000, builtinAi: 30_000 };
const messages = new Map<string, string>();

function setStatus(text: string, key = 'page') {
  if (text) messages.set(key, text);
  else messages.delete(key);
  $('status').textContent = [...messages.values()].join('\n');
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
    const mine = live.get(t.id);
    if (mine) {
      run.append(button('Stop', () => mine.ctl.abort()));
      if (mine.skipLabel && mine.skip) run.append(' ', button(mine.skipLabel, mine.skip));
    } else {
      run.append(button(r.status === 'not run' ? 'Run' : 'Run again', () => void runTest(t.id)));
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
  again.disabled = failing.every((id) => live.has(id));
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

function failText(error: unknown): string {
  if (error instanceof StoppedError) return 'Stopped';
  if (error instanceof TimeoutError) return error.message;
  return errorText(error);
}

// Resolves false when the owner pressed Stop. Never blocks, and is blocked by, any other test.
async function runTest(id: TestId): Promise<boolean> {
  if (live.has(id)) return false;
  const ctl = new AbortController();
  const entry: Live = { ctl, skipLabel: null };
  live.set(id, entry);
  const cleanups = cleanupStack();
  const numbers: Record<string, Value> = {};
  const run: Run = {
    id,
    signal: ctl.signal,
    numbers,
    say: (text) => setStatus(text, id),
    stage: (name) => {
      numbers.stage = name;
      if (live.get(id) === entry) update(id, { status: 'running', numbers: { ...numbers } });
    },
    cleanup: cleanups.add,
    stream: (stream) => {
      cleanups.add(() => stopStream(stream));
      return stream;
    },
    setSkip: (label, skip) => {
      if (live.get(id) !== entry) return;
      entry.skipLabel = label;
      entry.skip = skip;
      render();
    },
  };
  update(id, { status: 'running', numbers: {} });
  let stopped = false;
  let outcome: { status: Status } | { error: unknown };
  try {
    outcome = { status: (await watchdog(() => RUNNERS[id](run), { ms: LIMIT_MS[id], ctl })) ?? 'pass' };
  } catch (error) {
    outcome = { error };
  }
  // Teardown runs even when the test's own code is still stuck on an await.
  ctl.abort();
  cleanups.run((e) => console.error(`Klipkord: cleanup after check ${id} failed`, e));
  live.delete(id);
  setStatus('', id);
  const ranAt = new Date().toISOString();
  if ('status' in outcome) {
    update(id, { status: outcome.status, numbers, ranAt });
    setStatus(outcome.status === 'pass' ? `${nameOf(id)}: done.` : `${nameOf(id)}: done, with a warning. See the numbers.`);
  } else {
    stopped = outcome.error instanceof StoppedError;
    if (!stopped) console.error(`Klipkord: could not run check ${id}`, outcome.error);
    update(id, { status: 'fail', numbers, error: failText(outcome.error), ranAt });
    setStatus(stopped ? `${nameOf(id)}: stopped.` : `${nameOf(id)}: failed. The error is in the table.`);
  }
  return !stopped;
}

const nameOf = (id: TestId) => TESTS.find((t) => t.id === id)!.name;

// Starts every failing test at once; one stuck test cannot hold back the others.
function rerunFailing() {
  for (const id of failingTests(results)) void runTest(id);
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
  let stopped = false;
  return {
    stream,
    stop: () => {
      if (stopped) return;
      stopped = true;
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

async function record(run: Run, stream: MediaStream, mimeType: string, ms: number): Promise<{ bytes: number; type: string }> {
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  const stop = startRecorder(recorder, (b) => chunks.push(b));
  run.cleanup(() => recorder.state !== 'inactive' && recorder.stop());
  try {
    await pause(ms, run.signal);
  } finally {
    await stop().catch(() => undefined);
  }
  const blob = new Blob(chunks, { type: recorder.mimeType });
  return { bytes: blob.size, type: recorder.mimeType };
}

async function testMp4(run: Run) {
  const { numbers } = run;
  for (const [k, t] of Object.entries(TYPES)) numbers[`supported.${k}`] = MediaRecorder.isTypeSupported(t);
  const mp4 = [TYPES.mp4H264Aac, TYPES.mp4H264AacHigh, TYPES.mp4Plain].find((t) => MediaRecorder.isTypeSupported(t));
  const src = animatedSource();
  run.cleanup(src.stop);
  try {
    if (mp4) {
      run.say('Recording 10 s as MP4...');
      const r = await record(run, src.stream, mp4, 10_000);
      numbers['mp4.requested'] = mp4;
      numbers['mp4.type'] = r.type;
      numbers['mp4.bytes'] = r.bytes;
    } else {
      numbers['mp4.requested'] = null;
    }
    if (MediaRecorder.isTypeSupported(TYPES.webmVp9Opus)) {
      run.say('Recording 10 s as WebM...');
      const r = await record(run, src.stream, TYPES.webmVp9Opus, 10_000);
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

async function testSound(run: Run): Promise<Status> {
  const { numbers, signal } = run;
  const pick = await chooseScreen(['screen', 'window', 'tab', 'audio'], signal);
  const stream = run.stream(await desktopStream(pick.id, true, signal));
  const track = stream.getAudioTracks()[0];
  numbers.canRequestAudioTrack = pick.canRequestAudioTrack;
  numbers.audioTrack = Boolean(track);
  numbers.audioTrackLabel = track?.label ?? null;
  const ctx = new AudioContext();
  run.cleanup(() => void ctx.close().catch(() => undefined));
  try {
    if (!track) return 'fail';
    run.say('Listening for 10 s. Keep the video with sound playing...');
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
    void ctx.close().catch(() => undefined);
    stopStream(stream);
  }
}

// Videos stay in the page as small previews; Chrome only delivers frames to attached, visible videos.
async function playing(run: Run, stream: MediaStream, label: string): Promise<HTMLVideoElement> {
  const figure = document.createElement('figure');
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  const caption = document.createElement('figcaption');
  caption.textContent = label;
  figure.append(video, caption);
  $('sources').append(figure);
  run.cleanup(() => {
    video.srcObject = null;
    figure.remove();
  });
  await guard(video.play(), { ms: 10_000, what: `${label} video`, signal: run.signal });
  return video;
}

function trackFrames(video: HTMLVideoElement, times: number[], until: () => boolean) {
  const cb = (now: number) => {
    times.push(now);
    if (!until()) video.requestVideoFrameCallback(cb);
  };
  video.requestVideoFrameCallback(cb);
}

async function testComposite(run: Run) {
  const { numbers, signal } = run;
  const preview = $('preview');
  const out = $<HTMLCanvasElement>('composite');
  let done = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let recorder: MediaRecorder | undefined;
  run.cleanup(() => {
    done = true;
    clearInterval(timer);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    $('sources').replaceChildren();
    preview.hidden = true;
  });
  {
    run.stage('screen-picker');
    const pick = await chooseScreen(['screen', 'window'], signal);
    const screenStream = run.stream(await desktopStream(pick.id, false, signal));
    run.stage('camera');
    run.say('Waiting for the camera. Allow it if Chrome asks...');
    const cameraStream = await guard(navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 } }), {
      ms: 60_000,
      what: 'Camera',
      signal,
      dispose: stopStream,
    });
    run.stream(cameraStream);

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
    run.say('Starting the preview...');
    const screenVideo = await playing(run, screenStream, 'Screen');
    const cameraVideo = await playing(run, cameraStream, 'Camera');
    run.stage('drawing');

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
    run.stream(outStream);
    const outVideo = await playing(run, outStream, 'Recorded stream');

    const screenTimes: number[] = [];
    const outTimes: number[] = [];
    trackFrames(screenVideo, screenTimes, () => done);
    trackFrames(outVideo, outTimes, () => done);
    const recorderType = MediaRecorder.isTypeSupported(TYPES.mp4H264Aac) ? 'video/mp4;codecs=avc1.42E01E' : 'video/webm;codecs=vp9';
    run.stage('recording');
    recorder = new MediaRecorder(outStream, { mimeType: recorderType, videoBitsPerSecond: 8_000_000 });
    let bytes = 0;
    const stopRecorder = startRecorder(recorder, (b) => (bytes += b.size));

    for (let s = 60; s > 0; s--) {
      run.say(`Compositing and recording at ${W}x${H}... ${s} s left`);
      await pause(1000, signal);
    }
    done = true;
    clearInterval(timer);
    await stopRecorder();

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
    run.stage('done');
  }
}

// --- 4. Whisper ---

const SAMPLE_RATE = 16_000;
const CHUNK_S = 10;
const CHUNKS = 3;
const MINUTE = 60_000;
const PROBE_URL = 'https://huggingface.co/onnx-community/whisper-tiny/resolve/main/config.json';

type Answer = Record<string, unknown>;

class WhisperWorker {
  private worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  private waiting: { resolve: (m: Answer) => void; reject: (e: Error) => void }[] = [];
  onProgress: ((m: Answer) => void) | null = null;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<Answer>) => {
      if (e.data.type === 'progress') return this.onProgress?.(e.data);
      const w = this.waiting.shift();
      if (e.data.type === 'error') w?.reject(new Error(String(e.data.message)));
      else w?.resolve(e.data);
    };
    this.worker.onerror = (e) => this.failAll(new Error(`Whisper worker: ${e.message || 'could not start'}`));
  }

  private failAll(error: Error) {
    for (const w of this.waiting.splice(0)) w.reject(error);
  }

  // The worker answers each message once, in order; progress messages are not answers.
  send(msg: unknown, opts: { ms: number; what: string; signal?: AbortSignal }, transfer: Transferable[] = []) {
    const answer = new Promise<Answer>((resolve, reject) => {
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

// Shows the numbers in the table as they change, so a timeout or Stop still leaves them on screen.
function liveNumbers(run: Run) {
  let current = '';
  let shownAt = 0;
  return {
    stage(name: string) {
      current = name;
      shownAt = performance.now();
      run.stage(name);
    },
    refresh() {
      if (performance.now() - shownAt < 500) return;
      shownAt = performance.now();
      run.stage(current);
    },
  };
}
type LiveNumbers = ReturnType<typeof liveNumbers>;

async function recordMic(run: Run, onChunk: (index: number) => void): Promise<Float32Array[]> {
  const { signal } = run;
  const stream = await guard(navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }), {
    ms: MINUTE,
    what: 'Microphone',
    signal,
    dispose: stopStream,
  });
  run.stream(stream);
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  run.cleanup(() => void ctx.close().catch(() => undefined));
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor keeps this check to one file; T1 can move to an AudioWorklet.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const size = SAMPLE_RATE * CHUNK_S;
  const chunks: Float32Array[] = [];
  let buf = new Float32Array(size);
  let fill = 0;
  try {
    await guard(ctx.resume(), { ms: 10_000, what: 'Audio', signal });
    const full = new Promise<void>((resolve) => {
      node.onaudioprocess = (e) => {
        if (chunks.length >= CHUNKS) return;
        const input = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
          buf[fill++] = input[i]!;
          if (fill === size) {
            chunks.push(buf);
            onChunk(chunks.length - 1);
            buf = new Float32Array(size);
            fill = 0;
            if (chunks.length >= CHUNKS) {
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
    return chunks;
  } finally {
    node.disconnect();
    source.disconnect();
    stopStream(stream);
    void ctx.close().catch(() => undefined);
  }
}

// Downloads and loads one model, reporting downloadedMb as it goes and downloadS and loadS when known.
async function loadModel(worker: WhisperWorker, model: string, key: string, live: LiveNumbers, run: Run, signal: AbortSignal) {
  const n = run.numbers;
  const files = new Map<string, FileProgress>();
  const start = performance.now();
  let loading = false;
  n[`${key}.model`] = `onnx-community/${model}`;
  live.stage(`download ${model}`);
  run.say(`Downloading ${model} (cached after the first run)...`);
  worker.onProgress = (p) => {
    const file = String(p.file);
    const f = files.get(file) ?? { loaded: 0, total: 0, done: false };
    const total = Number(p.total);
    const loaded = Number(p.loaded);
    if (total > 0) f.total = total;
    if (loaded > f.loaded) f.loaded = loaded;
    if (p.status === 'done') f.done = true;
    files.set(file, f);
    const s = downloadSummary(files.values());
    n[`${key}.files`] = `${s.doneFiles}/${s.files}`;
    n[`${key}.downloadedMb`] = megabytes(s.loadedBytes);
    n[`${key}.totalMb`] = megabytes(s.totalBytes);
    // Files start in groups, so the last moment every known file is done marks the end of the download.
    if (s.allDone) n[`${key}.downloadS`] = round((performance.now() - start) / 1000);
    if (s.allDone !== loading) {
      loading = s.allDone;
      live.stage(`${loading ? 'load' : 'download'} ${model}`);
      run.say(loading ? `Loading ${model}...` : `Downloading ${model}...`);
    } else {
      live.refresh();
    }
  };
  try {
    const m = await worker.send({ type: 'load', model: `onnx-community/${model}` }, { ms: 10 * MINUTE, what: `Loading ${model}`, signal });
    const totalS = (performance.now() - start) / 1000;
    const downloadS = typeof n[`${key}.downloadS`] === 'number' ? (n[`${key}.downloadS`] as number) : totalS;
    n[`${key}.loadS`] = round(totalS - downloadS);
    n[`${key}.device`] = String(m.device);
    n[`${key}.dtype`] = String(m.dtype);
    n[`${key}.wasmThreads`] = (m.threads as number | null) ?? null;
    n[`${key}.crossOriginIsolated`] = Boolean(m.crossOriginIsolated);
    n[`${key}.webgpuError`] = (m.webgpuError as string | null) ?? null;
  } finally {
    worker.onProgress = null;
  }
}

// Runs a loaded model over the saved chunks one by one; returns the real-time factor, or null with no chunks done.
async function transcribeAll(worker: WhisperWorker, model: string, key: string, chunks: Float32Array[], live: LiveNumbers, run: Run, signal: AbortSignal) {
  const n = run.numbers;
  const ms: number[] = [];
  const words: number[] = [];
  live.stage(`transcribe ${model}`);
  for (const [i, chunk] of chunks.entries()) {
    run.say(`${model}: chunk ${i + 1} of ${chunks.length}...`);
    const m = await worker.send({ type: 'transcribe', id: i, audio: chunk.slice() }, { ms: 5 * MINUTE, what: `${model} chunk ${i + 1}`, signal });
    ms.push(Number(m.ms));
    words.push(Number(m.words));
    n[`${key}.chunks`] = ms.length;
    n[`${key}.chunkMs`] = ms.map((v) => Math.round(v)).join(' ');
    n[`${key}.realTimeFactor`] = realTimeFactor(ms.reduce((a, b) => a + b, 0), ms.length * CHUNK_S * 1000);
    n[`${key}.worstRealTimeFactor`] = realTimeFactor(Math.max(...ms), CHUNK_S * 1000);
    n[`${key}.words`] = words.reduce((a, b) => a + b, 0);
    live.stage(`transcribe ${model}`);
  }
  return ms.length ? (n[`${key}.realTimeFactor`] as number) : null;
}

async function testWhisper(run: Run) {
  const { numbers, signal } = run;
  numbers.chunkS = CHUNK_S;
  numbers.audioS = CHUNK_S * CHUNKS;
  numbers.cores = navigator.hardwareConcurrency ?? null;
  const live = liveNumbers(run);
  const worker = new WhisperWorker();
  run.cleanup(() => worker.terminate());
  try {
    // The mic records only once whisper-tiny is ready; every model then runs on the same chunks.
    await loadModel(worker, 'whisper-tiny', 'tiny', live, run, signal);
    live.stage('record');
    run.say(`Recording ${CHUNK_S * CHUNKS} s from the microphone. Talk or play speech...`);
    const chunks = await recordMic(run, (i) => run.say(`Recording... chunk ${i + 1} of ${CHUNKS} done`));
    numbers.micLevelDb = levelDb(chunks[chunks.length - 1]!);
    await transcribeAll(worker, 'whisper-tiny', 'tiny', chunks, live, run, signal);
    await worker.send({ type: 'dispose' }, { ms: MINUTE, what: 'Unloading whisper-tiny', signal });

    await loadModel(worker, 'whisper-base', 'base', live, run, signal);
    const baseRtf = await transcribeAll(worker, 'whisper-base', 'base', chunks, live, run, signal);
    await worker.send({ type: 'dispose' }, { ms: MINUTE, what: 'Unloading whisper-base', signal });

    const note = smallSkipNote(baseRtf);
    if (note) {
      numbers['small.skipped'] = note;
    } else {
      // whisper-small can still be slow, so the owner may skip it and keep the rest.
      const skip = new AbortController();
      run.setSkip('Skip whisper-small', () => skip.abort());
      const smallSignal = AbortSignal.any([signal, skip.signal]);
      try {
        await loadModel(worker, 'whisper-small', 'small', live, run, smallSignal);
        await transcribeAll(worker, 'whisper-small', 'small', chunks, live, run, smallSignal);
        numbers['small.skipped'] = false;
      } catch (error) {
        if (!(error instanceof StoppedError) || signal.aborted) throw error;
        numbers['small.skipped'] = 'skipped by the owner';
      } finally {
        run.setSkip(null);
      }
    }
    live.stage('done');
  } finally {
    worker.terminate();
  }
}

async function probeFromPage(): Promise<string> {
  const start = performance.now();
  try {
    const res = await fetch(PROBE_URL, { cache: 'no-store' });
    const bytes = (await res.arrayBuffer()).byteLength;
    return `HTTP ${res.status} ${res.statusText}, ${bytes} bytes, ${Math.round(performance.now() - start)} ms, from ${res.url}`;
  } catch (error) {
    return `error: ${errorText(error)}`;
  }
}

// Fetches whisper-tiny's config.json from the page and from the worker, for a quick look at the model host.
async function probeModelDownload(b: HTMLButtonElement) {
  b.disabled = true;
  setStatus('Testing the model download...', 'probe');
  const page = await guard(probeFromPage(), { ms: 30_000, what: 'Model download test' }).catch((e: unknown) => `error: ${errorText(e)}`);
  const worker = new WhisperWorker();
  let inWorker: string;
  try {
    inWorker = String((await worker.send({ type: 'probe', url: PROBE_URL }, { ms: 30_000, what: 'Model download test in the worker' })).text);
  } catch (error) {
    inWorker = `error: ${errorText(error)}`;
  } finally {
    worker.terminate();
  }
  results = { ...results, machine: { ...results.machine, modelFetchPage: page, modelFetchWorker: inWorker } };
  render();
  setStatus(`Model download test. Page: ${page}. Worker: ${inWorker}`, 'probe');
  b.disabled = false;
}

const probeButton = button('Test model download only', () => void probeModelDownload(probeButton));
$('rerun').after(' ', probeButton);

// --- 5. Built-in AI ---

async function testBuiltinAi({ numbers, signal }: Run): Promise<Status> {
  const g = globalThis as unknown as Record<string, { availability?: () => Promise<unknown> } | undefined>;
  const version = typeof results.machine.chrome === 'string' ? results.machine.chrome : navigator.userAgent;
  numbers.chrome = typeof results.machine.chrome === 'string' ? results.machine.chrome : (/Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? null);
  const found: string[] = [];
  for (const name of ['Summarizer', 'LanguageModel']) {
    try {
      const a = availabilityOf(await guard(g[name]?.availability?.() ?? Promise.resolve(undefined), { ms: 30_000, what: name, signal }));
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
$('rerun').addEventListener('click', rerunFailing);

const BUILD = (() => {
  try {
    return chrome.runtime.getManifest().version || 'dev';
  } catch {
    return 'dev';
  }
})();
$('build').textContent = `Build ${BUILD}`;
results = emptyResults({}, new Date(), BUILD);
render();
void machineInfo().then((machine) => {
  results = { ...results, machine };
  render();
});
