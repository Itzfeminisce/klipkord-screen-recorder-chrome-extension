import { TESTS, availabilityOf, emptyResults, errorText, numberLines, resultsJson, withResult } from '@/lib/check/results';
import type { Results, TestId, TestResult, Value } from '@/lib/check/results';
import { frameStats, levelDb, mean, megabytes, realTimeFactor, round } from '@/lib/check/stats';

const HINTS: Record<TestId, string> = {
  mp4: 'Records 10 s of a test animation with a tone, once as MP4 and once as WebM. No prompts.',
  sound: 'Pick "Entire screen" and turn on "Also share system audio". Play some sound for 10 s.',
  composite: 'Pick "Entire screen" and allow the camera. Play a video on screen. Takes 60 s.',
  whisper: 'Allow the microphone and talk or play speech for 2 minutes. Downloads whisper-base and whisper-small.',
  builtinAi: 'Asks Chrome whether Summarizer and LanguageModel are available. No prompts.',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let results: Results;

function setStatus(text: string) {
  $('status').textContent = text;
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
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Run';
    button.disabled = Object.values(results.tests).some((x) => x.status === 'running');
    button.addEventListener('click', () => void runTest(t.id));
    run.append(button);
    const status = document.createElement('td');
    status.textContent = r.status;
    status.className = r.status.replace(' ', '-');
    const lines = document.createElement('td');
    lines.className = 'lines';
    lines.textContent = numberLines(r).join('\n');
    tr.append(name, run, status, lines);
    rows.append(tr);
  }
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

async function runTest(id: TestId) {
  const runners: Record<TestId, () => Promise<Record<string, Value>>> = {
    mp4: testMp4,
    sound: testSound,
    composite: testComposite,
    whisper: testWhisper,
    builtinAi: testBuiltinAi,
  };
  update(id, { status: 'running', numbers: {} });
  try {
    const numbers = await runners[id]();
    update(id, { status: 'pass', numbers });
    setStatus('Done.');
  } catch (error) {
    console.error(`Klipkord: could not run check ${id}`, error);
    update(id, { status: 'fail', numbers: {}, error: errorText(error) });
    setStatus('Test failed. The error is in the table.');
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
  };
  try {
    if (nav.userAgentData) {
      const h = await nav.userAgentData.getHighEntropyValues(['platformVersion', 'fullVersionList']);
      info.platform = `${nav.userAgentData.platform} ${String(h.platformVersion ?? '')}`.trim();
      const list = (h.fullVersionList as { brand: string; version: string }[] | undefined) ?? [];
      info.chrome = list.find((b) => b.brand === 'Google Chrome')?.version ?? null;
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
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

async function record(stream: MediaStream, mimeType: string, ms: number): Promise<{ bytes: number; type: string }> {
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));
  recorder.start(1000);
  await sleep(ms);
  recorder.stop();
  await stopped;
  const blob = new Blob(chunks, { type: recorder.mimeType });
  return { bytes: blob.size, type: recorder.mimeType };
}

async function testMp4() {
  const numbers: Record<string, Value> = {};
  for (const [k, t] of Object.entries(TYPES)) numbers[`supported.${k}`] = MediaRecorder.isTypeSupported(t);
  const mp4 = [TYPES.mp4H264Aac, TYPES.mp4H264AacHigh, TYPES.mp4Plain].find((t) => MediaRecorder.isTypeSupported(t));
  const src = animatedSource();
  try {
    if (mp4) {
      setStatus('Recording 10 s as MP4...');
      const r = await record(src.stream, mp4, 10_000);
      numbers['mp4.requested'] = mp4;
      numbers['mp4.type'] = r.type;
      numbers['mp4.bytes'] = r.bytes;
    } else {
      numbers['mp4.requested'] = null;
    }
    if (MediaRecorder.isTypeSupported(TYPES.webmVp9Opus)) {
      setStatus('Recording 10 s as WebM...');
      const r = await record(src.stream, TYPES.webmVp9Opus, 10_000);
      numbers['webm.type'] = r.type;
      numbers['webm.bytes'] = r.bytes;
    }
  } finally {
    src.stop();
  }
  return numbers;
}

// --- 2 and 3. Screen capture ---

// desktopCapture runs in this extension page, and the stream id is consumed right here.
function chooseScreen(sources: `${chrome.desktopCapture.DesktopCaptureSourceType}`[]): Promise<{ id: string; canRequestAudioTrack: boolean }> {
  return new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(sources as chrome.desktopCapture.DesktopCaptureSourceType[], (id, options) => {
      if (!id) reject(new Error('Screen picker was cancelled'));
      else resolve({ id, canRequestAudioTrack: Boolean(options?.canRequestAudioTrack) });
    });
  });
}

function desktopStream(id: string, audio: boolean): Promise<MediaStream> {
  const source = { chromeMediaSource: 'desktop', chromeMediaSourceId: id };
  return navigator.mediaDevices.getUserMedia({
    audio: audio ? ({ mandatory: source } as MediaTrackConstraints) : false,
    video: { mandatory: { ...source, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 } } as MediaTrackConstraints,
  });
}

async function testSound() {
  const pick = await chooseScreen(['screen', 'window', 'tab', 'audio']);
  const stream = await desktopStream(pick.id, true);
  const track = stream.getAudioTracks()[0];
  const numbers: Record<string, Value> = {
    canRequestAudioTrack: pick.canRequestAudioTrack,
    audioTrack: Boolean(track),
    audioTrackLabel: track?.label ?? null,
  };
  try {
    if (!track) return numbers;
    setStatus('Listening for 10 s. Play some sound...');
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const levels: number[] = [];
    let silent = 0;
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      analyser.getFloatTimeDomainData(buf);
      const db = levelDb(buf);
      if (db === null) silent++;
      else levels.push(db);
    }
    await ctx.close();
    numbers.peakLevelDb = levels.length ? Math.max(...levels) : null;
    numbers.meanLevelDb = levels.length ? round(mean(levels)) : null;
    numbers.silentSamples = `${silent}/100`;
    return numbers;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

function playing(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  document.body.append(video);
  return video.play().then(() => video);
}

function trackFrames(video: HTMLVideoElement, times: number[], until: () => boolean) {
  const cb = (now: number) => {
    times.push(now);
    if (!until()) video.requestVideoFrameCallback(cb);
  };
  video.requestVideoFrameCallback(cb);
}

async function testComposite() {
  const pick = await chooseScreen(['screen', 'window']);
  const screenStream = await desktopStream(pick.id, false);
  const cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 } });
  const W = 1920;
  const H = 1080;
  const off = new OffscreenCanvas(W, H);
  const ctx = off.getContext('2d')!;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const presenter = out.getContext('bitmaprenderer')!;
  const outStream = out.captureStream(30);
  const screenVideo = await playing(screenStream);
  const cameraVideo = await playing(cameraStream);
  const outVideo = await playing(outStream);
  const drawMs: number[] = [];
  const screenTimes: number[] = [];
  const outTimes: number[] = [];
  let done = false;
  trackFrames(screenVideo, screenTimes, () => done);
  trackFrames(outVideo, outTimes, () => done);
  const recorderType = MediaRecorder.isTypeSupported(TYPES.mp4H264Aac) ? 'video/mp4;codecs=avc1.42E01E' : 'video/webm;codecs=vp9';
  const recorder = new MediaRecorder(outStream, { mimeType: recorderType, videoBitsPerSecond: 8_000_000 });
  let bytes = 0;
  recorder.ondataavailable = (e) => (bytes += e.data.size);
  const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));

  const bubble = 280;
  const draw = () => {
    if (done) return;
    const t0 = performance.now();
    ctx.drawImage(screenVideo, 0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W - bubble / 2 - 40, H - bubble / 2 - 40, bubble / 2, 0, Math.PI * 2);
    ctx.clip();
    const side = Math.min(cameraVideo.videoWidth, cameraVideo.videoHeight) || 1;
    ctx.drawImage(
      cameraVideo,
      (cameraVideo.videoWidth - side) / 2,
      (cameraVideo.videoHeight - side) / 2,
      side,
      side,
      W - bubble - 40,
      H - bubble - 40,
      bubble,
      bubble,
    );
    ctx.restore();
    presenter.transferFromImageBitmap(off.transferToImageBitmap());
    drawMs.push(performance.now() - t0);
  };
  // A steady 30 fps clock; screen frames only arrive when the screen changes.
  const timer = setInterval(draw, 1000 / 30);
  recorder.start(1000);
  try {
    for (let s = 60; s > 0; s--) {
      setStatus(`Compositing and recording... ${s} s left`);
      await sleep(1000);
    }
  } finally {
    done = true;
    clearInterval(timer);
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    for (const s of [screenStream, cameraStream, outStream]) s.getTracks().forEach((t) => t.stop());
    for (const v of [screenVideo, cameraVideo, outVideo]) v.remove();
  }
  const outStats = frameStats(outTimes, 30);
  const screenStats = frameStats(screenTimes, 30);
  const screenSettings = screenStream.getVideoTracks()[0]?.getSettings();
  return {
    screenSize: screenSettings ? `${screenSettings.width}x${screenSettings.height}` : null,
    screenMeanFps: screenStats.meanFps,
    outputFrames: outStats.frames,
    outputMeanFps: outStats.meanFps,
    outputDroppedFrames: outStats.droppedFrames,
    meanDrawMs: round(mean(drawMs), 2),
    maxDrawMs: round(Math.max(0, ...drawMs), 2),
    recorderType: recorder.mimeType,
    recordedMb: megabytes(bytes),
  };
}

// --- 4. Whisper ---

const SAMPLE_RATE = 16_000;
const CHUNK_S = 10;
const CHUNKS = 12;

class WhisperWorker {
  private worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  private waiting: ((m: Record<string, unknown>) => void)[] = [];

  constructor() {
    this.worker.onmessage = (e: MessageEvent<Record<string, unknown>>) => this.waiting.shift()?.(e.data);
  }

  // The worker answers each message once, in order.
  send(msg: unknown, transfer: Transferable[] = []): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      this.waiting.push((m) => (m.type === 'error' ? reject(new Error(String(m.message))) : resolve(m)));
      this.worker.postMessage(msg, transfer);
    });
  }

  terminate() {
    this.worker.terminate();
  }
}

async function recordMic(onChunk: (chunk: Float32Array, index: number) => void): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor keeps this check to one file; T1 can move to an AudioWorklet.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const size = SAMPLE_RATE * CHUNK_S;
  let buf = new Float32Array(size);
  let fill = 0;
  let index = 0;
  await new Promise<void>((resolve) => {
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
  node.disconnect();
  source.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  await ctx.close();
}

async function loadModel(worker: WhisperWorker, model: string, numbers: Record<string, Value>, key: string) {
  setStatus(`Loading ${model} (first run downloads it)...`);
  const m = await worker.send({ type: 'load', model: `onnx-community/${model}` });
  numbers[`${key}.device`] = String(m.device);
  numbers[`${key}.webgpuError`] = (m.webgpuError as string | null) ?? null;
  numbers[`${key}.downloadMb`] = megabytes(Number(m.downloadBytes));
  numbers[`${key}.loadS`] = round(Number(m.loadMs) / 1000);
}

function chunkStats(ms: number[], words: number[], numbers: Record<string, Value>, key: string) {
  numbers[`${key}.chunks`] = ms.length;
  numbers[`${key}.meanChunkMs`] = Math.round(mean(ms));
  numbers[`${key}.realTimeFactor`] = realTimeFactor(mean(ms), CHUNK_S * 1000);
  numbers[`${key}.worstRealTimeFactor`] = realTimeFactor(Math.max(0, ...ms), CHUNK_S * 1000);
  numbers[`${key}.words`] = words.reduce((a, b) => a + b, 0);
}

async function testWhisper() {
  const numbers: Record<string, Value> = { chunkS: CHUNK_S, audioS: CHUNK_S * CHUNKS };
  const worker = new WhisperWorker();
  try {
    // whisper-base transcribes live while the mic records; whisper-small then runs on the same chunks.
    await loadModel(worker, 'whisper-base', numbers, 'base');
    const chunks: Float32Array[] = [];
    const pending: Promise<Record<string, unknown>>[] = [];
    setStatus('Recording 2 minutes from the microphone. Talk or play speech...');
    await recordMic((chunk, i) => {
      chunks.push(chunk);
      setStatus(`Recording... chunk ${i + 1} of ${CHUNKS}`);
      pending.push(worker.send({ type: 'transcribe', id: i, audio: chunk.slice() }));
    });
    setStatus('Finishing whisper-base...');
    const baseDone = await Promise.all(pending);
    chunkStats(
      baseDone.map((m) => Number(m.ms)),
      baseDone.map((m) => Number(m.words)),
      numbers,
      'base',
    );
    await worker.send({ type: 'dispose' });
    await loadModel(worker, 'whisper-small', numbers, 'small');
    const ms: number[] = [];
    const words: number[] = [];
    for (const [i, chunk] of chunks.entries()) {
      setStatus(`whisper-small: chunk ${i + 1} of ${CHUNKS}...`);
      const m = await worker.send({ type: 'transcribe', id: i, audio: chunk });
      ms.push(Number(m.ms));
      words.push(Number(m.words));
    }
    chunkStats(ms, words, numbers, 'small');
    return numbers;
  } finally {
    worker.terminate();
  }
}

// --- 5. Built-in AI ---

async function testBuiltinAi() {
  const g = globalThis as unknown as Record<string, { availability?: () => Promise<unknown> } | undefined>;
  const numbers: Record<string, Value> = {};
  for (const name of ['Summarizer', 'LanguageModel']) {
    try {
      numbers[name] = availabilityOf(await g[name]?.availability?.());
    } catch (error) {
      console.error(`Klipkord: could not check ${name}`, error);
      numbers[name] = `error: ${errorText(error)}`;
    }
  }
  return numbers;
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

results = emptyResults({}, new Date());
render();
void machineInfo().then((machine) => {
  results = { ...results, machine };
  render();
});
