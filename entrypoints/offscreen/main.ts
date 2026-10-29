import { cleanupStack, guard } from '@/lib/check/guard';
import { deleteRecording, putRecording, updateRecording, type RecordingPatch } from '@/lib/db';
import { onMessage, send, type MessageOf } from '@/lib/messages';
import { createMix, createSilenceWatch, type Mix } from '@/lib/mix';
import {
  IDLE, VIDEO_BITRATE, chooseMime, chooseVoiceMime, clockElapsed, clockPause, clockResume, clockStart, containerOf,
  createChunkWriter, shortClock, type EndReason, type RecorderState,
} from '@/lib/recorder';
import { pickSource, type RecorderReply } from '@/lib/capture';
import { floatsBubble, type Bubble, type BubbleStatus } from '@/lib/bubble';
import { updateSettings } from '@/lib/settings';
import { openFloatingBubble, type FloatingBubble } from './bubble';
import { createCompositor, type Compositor, type Ticker } from '@/lib/compositor';
import { freeBytes, shouldAutoStop } from '@/lib/storageMath';
import { videoStore } from '@/lib/videoStore';
import {
  cancelTranscript, currentStatus, finishTranscript, pauseTranscript, startTranscript, stopCapture, transcriptPatch, useGroq,
} from './transcript';

// The recorder tab owns every stream and recorder, so recording goes on with the side panel closed.
// It opens Chrome's picker itself: a picked stream id only works in the page that asked for it.

let state: RecorderState = IDLE;

function setState(patch: Partial<RecorderState>) {
  state = { ...state, ...patch };
  void send({ type: 'recorder/state', state });
  paint();
}

const live = document.getElementById('live')!;
const voice = document.getElementById('voice')!;
function paint() {
  const on = state.status === 'recording' || state.status === 'paused';
  live.hidden = !on;
  if (on) live.textContent = `Recording ${shortClock(clockElapsed(state.clock, Date.now()))}`;
  voice.hidden = !state.mic;
}
setInterval(paint, 1000);

// Read the window up front: sidePanel.open must run inside the click itself.
let windowId: number | undefined;
let tabId: number | undefined;
void chrome.tabs.getCurrent().then((tab) => { windowId = tab?.windowId; tabId = tab?.id; });
document.getElementById('back')!.addEventListener('click', () => {
  if (windowId !== undefined) chrome.sidePanel.open({ windowId }).catch((error) => console.error('Klipkord: could not open the side panel', error));
});

// The floating camera bubble (window or screen capture, "Floating on screen"). Chrome opens it only from a click here.
let wantBubble: Bubble | null = null;
let floating: FloatingBubble | null = null;
let opening = false;
const bubbleShow = document.getElementById('bubble-show')!;
const bubbleOn = document.getElementById('bubble-on')!;
const bubbleStatus = (): BubbleStatus => ({ wanted: Boolean(wantBubble), open: Boolean(floating), tabId, windowId });
function paintBubble() {
  bubbleShow.hidden = !wantBubble || Boolean(floating);
  bubbleOn.hidden = !wantBubble || !floating;
  void send({ type: 'bubble/status', status: bubbleStatus() });
}
function setFloating(bubble: Bubble | null) {
  wantBubble = bubble;
  if (!bubble && floating) {
    const open = floating;
    floating = null;
    open.close();
  }
  paintBubble();
}
document.getElementById('bubble-open')!.addEventListener('click', () => {
  if (!wantBubble || floating || opening) return;
  opening = true;
  openFloatingBubble(wantBubble.size, openCamera, {
    resized(size) {
      if (wantBubble) wantBubble = { ...wantBubble, size };
      updateSettings({ bubble: { size } }).catch((error) => console.error('Klipkord: could not save the bubble size', error));
    },
    closed() {
      floating = null;
      paintBubble();
    },
  })
    .then((opened) => {
      // The take ended while the camera was opening.
      if (opened && !wantBubble) return opened.close();
      floating = opened;
      paintBubble();
    })
    .catch((error) => console.error('Klipkord: could not open the camera bubble', error))
    .finally(() => { opening = false; });
});
document.getElementById('bubble-hide')!.addEventListener('click', () => floating?.close());

const stopTracks = (stream: MediaStream | null | undefined) => stream?.getTracks().forEach((t) => t.stop());

interface Streams {
  video: MediaStream;
  picture: MediaStreamTrack;        // what goes into the video's picture: the screen, or the screen with the bubble
  compositor: Compositor | null;
  mic: MediaStream | null;
  audio: MediaStreamTrack | null;   // what goes into the video's sound
  mix: Mix;
  cleanup: ReturnType<typeof cleanupStack>;
}
let streams: Streams | null = null;

type Writer = ReturnType<typeof createChunkWriter>;
interface Take {
  id: string;
  video: MediaRecorder;
  voice: MediaRecorder | null;
  videoWriter: Writer;
  voiceWriter: Writer | null;
  timers: ReturnType<typeof setInterval>[];
  discard: boolean;
}
let take: Take | null = null;

// One command at a time, so a shortcut and a click never interleave.
let queue: Promise<unknown> = Promise.resolve();
let inFlight = 0;
function run<T>(fn: () => Promise<T>): Promise<T> {
  inFlight++;
  const next = queue.then(fn).finally(() => {
    // The background skipped closing while this ran; tell it once nothing is left.
    if (--inFlight === 0 && !busy()) void send({ type: 'transcript/idle' });
  });
  queue = next.catch(() => undefined);
  return next;
}

// The background closes this document only when this says false.
const busy = () => Boolean(streams || take || inFlight || currentStatus()?.busy);

/** Waits for the last chunks to reach disk; past the limit the take keeps what was already committed. */
async function saveChunks(t: Take): Promise<boolean> {
  try {
    await guard(Promise.all([t.videoWriter.flush(), t.voiceWriter?.flush()]).then(() => videoStore.close(t.id)), {
      ms: FLUSH_MS, what: 'Saving the video',
    });
    return true;
  } catch (error) {
    console.error('Klipkord: could not save the last video chunks', error);
    return false;
  }
}
const FLUSH_MS = 30_000;

const ok: RecorderReply = { ok: true };
const fail = (error: string): RecorderReply => ({ ok: false, error });

async function openScreen(msg: MessageOf<'recorder/prepare'>, streamId: string, withSound: boolean): Promise<MediaStream> {
  const source = { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId };
  const video = { mandatory: { ...source, maxWidth: msg.maxWidth, maxHeight: msg.maxHeight, maxFrameRate: 30 } } as MediaTrackConstraints;
  const open = (audio: boolean) =>
    guard(navigator.mediaDevices.getUserMedia({ audio: audio ? ({ mandatory: source } as MediaTrackConstraints) : false, video }), {
      ms: 30_000,
      what: 'Screen capture',
      dispose: stopTracks,
    });
  if (!withSound) return open(false);
  try {
    return await open(true);
  } catch (error) {
    // A stream id is single-use only once it succeeds, so asking again without sound is safe.
    console.error('Klipkord: could not capture sound with the screen', error);
    return open(false);
  }
}

async function openMic(): Promise<MediaStream | null> {
  try {
    return await guard(
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      { ms: 15_000, what: 'Microphone', dispose: stopTracks },
    );
  } catch (error) {
    console.error('Klipkord: could not open the microphone', error);
    return null;
  }
}

// One worker clock for the compositor; each take starts and stops it.
const tick: Ticker = (fps, onTick) => {
  const worker = new Worker(new URL('./tick.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = onTick;
  worker.postMessage({ fps });
  return () => worker.terminate();
};

/** Null when the camera is busy, blocked or missing: the recording goes on without the bubble. */
async function openCamera(): Promise<MediaStream | null> {
  try {
    return await guard(navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 } }), {
      ms: 15_000, what: 'Camera', dispose: stopTracks,
    });
  } catch (error) {
    console.error('Klipkord: could not open the camera', error);
    return null;
  }
}

/** The screen with the bubble drawn in, or the screen track itself when the camera is off or busy. */
async function openPicture(video: MediaStream, msg: MessageOf<'recorder/prepare'>, cleanup: ReturnType<typeof cleanupStack>) {
  const screenTrack = video.getVideoTracks()[0];
  if (!screenTrack) throw new Error('No video track');
  // A floating bubble is recorded as part of the screen, so nothing is drawn.
  if (floatsBubble(msg.mode, msg.bubble, msg.camera)) return { picture: screenTrack, compositor: null };
  const camera = msg.camera ? await openCamera() : null;
  if (!camera) return { picture: screenTrack, compositor: null };
  // Stops the camera track (light off) on every teardown path.
  cleanup.add(() => stopTracks(camera));
  try {
    const compositor = await guard(createCompositor(video, camera, msg.bubble, tick), { ms: 10_000, what: 'Compositor', dispose: (c) => c.stop() });
    cleanup.add(() => compositor.stop());
    return { picture: compositor.track, compositor };
  } catch (error) {
    console.error('Klipkord: could not start the camera bubble', error);
    stopTracks(camera);
    return { picture: screenTrack, compositor: null };
  }
}

async function prepare(msg: MessageOf<'recorder/prepare'>): Promise<RecorderReply> {
  await teardown();
  const cleanup = cleanupStack();
  try {
    const picked = await pickSource(msg.mode, msg.sound);
    if (!picked) {
      setState(IDLE);
      return { ok: false, cancelled: true };
    }
    const video = await openScreen(msg, picked.streamId, msg.sound && picked.canRequestAudioTrack);
    cleanup.add(() => stopTracks(video));
    const mic = msg.mic ? await openMic() : null;
    cleanup.add(() => stopTracks(mic));
    const sound = video.getAudioTracks().length ? video : null;

    const ctx = new AudioContext();
    await ctx.resume().catch(() => undefined);
    const mix = createMix(ctx, mic, sound);
    cleanup.add(() => void mix.close());
    // Without a running AudioContext the mix is silent; keep the voice rather than nothing.
    const direct = mic?.getAudioTracks()[0] ?? sound?.getAudioTracks()[0] ?? null;
    const audio = ctx.state === 'running' ? mix.track : direct;
    if (ctx.state !== 'running') console.error('Klipkord: could not start the sound mixer', ctx.state);
    cleanup.add(() => mix.track?.stop());

    const track = video.getVideoTracks()[0];
    if (!track) throw new Error('No video track');
    track.addEventListener('ended', () => void run(sharingEnded));
    const { picture, compositor } = await openPicture(video, msg, cleanup);
    streams = { video, picture, compositor, mic, audio, mix, cleanup };
    setFloating(floatsBubble(msg.mode, msg.bubble, msg.camera) ? msg.bubble : null);
    setState({
      ...IDLE,
      status: 'armed', mode: msg.mode, quality: msg.quality,
      mic: Boolean(mic), micBlocked: msg.mic && !mic, sound: Boolean(sound),
    });
    return ok;
  } catch (error) {
    cleanup.run((e) => console.error('Klipkord: could not release capture', e));
    console.error('Klipkord: could not start capture', error);
    setState(IDLE);
    return fail(String(error));
  }
}

function recorderStopped(recorder: MediaRecorder | null): Promise<void> {
  if (!recorder || recorder.state === 'inactive') return Promise.resolve();
  const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
  recorder.stop();
  // Waits for the last chunk, but never hangs if the recorder does not answer.
  return guard(stopped, { ms: 5000, what: 'MediaRecorder stop' }).catch((error) => console.error('Klipkord: could not stop the recorder', error));
}

/** The height really recorded (already capped to the screen by the capture constraints). */
function capturedHeight(picture: MediaStreamTrack, screen: MediaStream): number | undefined {
  const h = picture.getSettings().height ?? screen.getVideoTracks()[0]?.getSettings().height;
  return h ? Math.round(h) : undefined;
}

async function begin(): Promise<RecorderReply> {
  if (!streams || state.status !== 'armed') return fail('not armed');
  const id = crypto.randomUUID();
  const quality = state.quality ?? '1080p';
  const videoTrack = streams.picture;
  const tracks = streams.audio ? [videoTrack, streams.audio] : [videoTrack];
  const mime = chooseMime((t) => MediaRecorder.isTypeSupported(t), Boolean(streams.audio));
  const onError = (error: unknown) => console.error('Klipkord: could not save a video chunk', error);

  await videoStore.open(id);
  const video = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE[quality] });
  const videoWriter = createChunkWriter((c) => videoStore.append(id, 'video', c), onError);
  const micTrack = streams.mic?.getAudioTracks()[0];
  const voiceMime = chooseVoiceMime((t) => MediaRecorder.isTypeSupported(t));
  const voice = micTrack ? new MediaRecorder(new MediaStream([micTrack]), { mimeType: voiceMime }) : null;
  const voiceWriter = voice ? createChunkWriter((c) => videoStore.append(id, 'voice', c), onError) : null;
  const t: Take = { id, video, voice, videoWriter, voiceWriter, timers: [], discard: false };
  video.ondataavailable = (e) => !t.discard && videoWriter.write(e.data);
  if (voice && voiceWriter) voice.ondataavailable = (e) => !t.discard && voiceWriter.write(e.data);

  const now = Date.now();
  await putRecording({
    id, title: 'Untitled recording', createdAt: now, duration: 0, status: 'recording',
    mode: state.mode ?? 'tab', quality, height: capturedHeight(videoTrack, streams.video), mime: containerOf(mime), bytes: 0,
    markers: [], notes: [], comments: [], transcript: [], transcriptPending: false, transcriptModel: 'live', edits: [],
  });
  video.start(1000);
  voice?.start(1000);
  take = t;
  setState({ status: 'recording', recordingId: id, clock: clockStart(now), silentMic: false, disk: undefined, endedBy: undefined });
  // The transcript listens to its own copy of the mic; the recorder never waits on it.
  void startTranscript(id, voice ? micTrack ?? null : null).catch((error) => console.error('Klipkord: could not start the transcript', error));

  const silence = createSilenceWatch();
  t.timers.push(
    setInterval(() => {
      if (state.status !== 'recording') return;
      const now = Date.now();
      void send({ type: 'recorder/tick', elapsed: clockElapsed(state.clock, now) });
      if (!streams?.mic) return;
      const silent = silence(streams.mix.micLevel(), now, state.muted);
      if (silent !== state.silentMic) setState({ silentMic: silent });
    }, 1000),
    setInterval(() => void persist(t), 5000),
    setInterval(() => void checkDisk(t), 10_000),
  );
  void checkDisk(t);
  return ok;
}

const takeBytes = (t: Take) => t.videoWriter.bytes + (t.voiceWriter?.bytes ?? 0);

// Keeps duration and size current so a crash leaves a recording Recovered can offer back.
// Patches only what the recorder owns: duration, bytes, status and the transcript fields.
async function persist(t: Take, patch: RecordingPatch = {}) {
  try {
    await updateRecording(t.id, { duration: clockElapsed(state.clock, Date.now()), bytes: takeBytes(t), ...transcriptPatch(t.id), ...patch });
  } catch (error) {
    console.error('Klipkord: could not update the recording', error);
  }
}

async function checkDisk(t: Take) {
  try {
    const free = freeBytes(await videoStore.usage());
    const seconds = clockElapsed(state.clock, Date.now()) / 1000;
    const bytesPerSecond = seconds > 2 ? takeBytes(t) / seconds : 0;
    setState({ disk: { free, bytesPerSecond } });
    if (shouldAutoStop(free) && take === t) void run(() => finish('disk-full'));
  } catch (error) {
    console.error('Klipkord: could not check free space', error);
  }
}

async function pauseTake(): Promise<RecorderReply> {
  if (!take || state.status !== 'recording') return fail('not recording');
  if (take.video.state === 'recording') take.video.pause();
  if (take.voice?.state === 'recording') take.voice.pause();
  pauseTranscript(true);
  // Commits what is written so far; a crash while paused loses nothing.
  void videoStore.close(take.id).catch((error) => console.error('Klipkord: could not save the video', error));
  setState({ status: 'paused', clock: clockPause(state.clock, Date.now()), silentMic: false });
  await persist(take, { status: 'paused' });
  return ok;
}

async function resumeTake(): Promise<RecorderReply> {
  if (!take || state.status !== 'paused') return fail('not paused');
  if (take.video.state === 'paused') take.video.resume();
  if (take.voice?.state === 'paused') take.voice.resume();
  pauseTranscript(false);
  setState({ status: 'recording', clock: clockResume(state.clock, Date.now()) });
  await persist(take, { status: 'recording' });
  return ok;
}

async function finish(endedBy: EndReason): Promise<RecorderReply> {
  const t = take;
  if (!t || (state.status !== 'recording' && state.status !== 'paused')) return fail('not recording');
  const clock = clockPause(state.clock, Date.now());
  setState({ status: 'saving', clock });
  t.timers.forEach(clearInterval);
  pauseTranscript(true);
  await Promise.all([recorderStopped(t.video), recorderStopped(t.voice)]);
  const saved = await saveChunks(t);
  take = null;
  stopCapture();
  const duration = clockElapsed(clock, Date.now());
  await persist(t, { status: 'processing', duration });
  await teardown();
  setState({ status: 'done', recordingId: t.id, endedBy, silentMic: false });
  if (!saved) return fail('last chunks not saved in time');
  // Catch-up and the base pass run after the recorder is done; this document stays open until they finish.
  void finishTranscript(t.id, duration).catch((error) => console.error('Klipkord: could not finish the transcript', error));
  return ok;
}

/** Stops the take without keeping anything: its chunks, files and record are removed. */
async function dropTake() {
  const t = take;
  if (!t) return;
  t.discard = true;
  cancelTranscript();
  t.timers.forEach(clearInterval);
  take = null;
  await Promise.all([recorderStopped(t.video), recorderStopped(t.voice)]);
  await guard(Promise.all([t.videoWriter.flush(), t.voiceWriter?.flush()]), { ms: FLUSH_MS, what: 'Stopping the writes' })
    .catch((error) => console.error('Klipkord: could not stop the video writes', error));
  await videoStore.remove(t.id).catch((error) => console.error('Klipkord: could not delete the video', error));
  await deleteRecording(t.id).catch((error) => console.error('Klipkord: could not delete the recording', error));
}

async function restart(): Promise<RecorderReply> {
  await dropTake();
  const live = streams?.video.getVideoTracks()[0]?.readyState === 'live';
  if (!live) {
    await teardown();
    setState(IDLE);
    return fail('sharing stopped');
  }
  setState({ status: 'armed', recordingId: undefined, clock: IDLE.clock, silentMic: false, disk: undefined, muted: false });
  streams?.mic?.getAudioTracks().forEach((t) => (t.enabled = true));
  return ok;
}

async function discard(): Promise<RecorderReply> {
  await dropTake();
  await teardown();
  setState(IDLE);
  return ok;
}

async function sharingEnded(): Promise<RecorderReply> {
  if (state.status === 'recording' || state.status === 'paused') return finish('sharing-stopped');
  if (state.status === 'armed') return discard();
  return ok;
}

async function setBubble(bubble: Bubble): Promise<RecorderReply> {
  streams?.compositor?.setBubble(bubble);
  if (wantBubble) {
    wantBubble = { ...wantBubble, size: bubble.size };
    floating?.setSize(bubble.size);
  }
  return ok;
}

async function mute(muted: boolean): Promise<RecorderReply> {
  streams?.mic?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  setState({ muted, silentMic: false });
  return ok;
}

/** Stops every track (camera and mic lights off), the compositor and the mixer. */
async function teardown() {
  const s = streams;
  streams = null;
  if (wantBubble || floating) setFloating(null);
  s?.cleanup.run((error) => console.error('Klipkord: could not release capture', error));
}

onMessage((msg) => {
  switch (msg.type) {
    case 'recorder/prepare': return run(() => prepare(msg));
    case 'recorder/begin': return run(begin);
    case 'recorder/pause': return run(pauseTake);
    case 'recorder/resume': return run(resumeTake);
    case 'recorder/stop': return run(() => finish('user'));
    case 'recorder/cancel': return run(discard);
    case 'recorder/restart': return run(restart);
    case 'recorder/discard': return run(discard);
    case 'recorder/mute': return run(() => mute(msg.muted));
    case 'recorder/bubble': return setBubble(msg.bubble);
    case 'bubble/get': return bubbleStatus();
    case 'transcript/get': return currentStatus() ?? { busy: false };
    case 'offscreen/busy': return busy();
    case 'transcript/use-groq': return useGroq().then(() => true);
    default: return undefined;
  }
});

addEventListener('pagehide', () => {
  take?.timers.forEach(clearInterval);
  if (take) void videoStore.close(take.id);
  void teardown();
});
