import { RING_SHARE, bubbleRect, fitRect, squareCrop, type Bubble } from './bubble';

/** Calls `onTick` about `fps` times a second until the returned stop is called. */
export type Ticker = (fps: number, onTick: () => void) => () => void;

export interface Compositor {
  track: MediaStreamTrack;     // screen with the round camera bubble, for MediaRecorder
  setBubble(bubble: Bubble): void;
  stop(): void;
}

const FPS = 30;

async function playing(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  return video;
}

/**
 * Draws the screen then a round crop of the camera onto a 2D canvas 30 times a second; the machine check
 * measured this path at 2 ms a frame. A regular canvas, because OffscreenCanvas has no captureStream.
 */
export async function createCompositor(screen: MediaStream, camera: MediaStream, bubble: Bubble, tick: Ticker): Promise<Compositor> {
  const [screenVideo, cameraVideo] = await Promise.all([playing(screen), playing(camera)]);
  const settings = screen.getVideoTracks()[0]?.getSettings();
  const W = screenVideo.videoWidth || settings?.width || 1920;
  const H = screenVideo.videoHeight || settings?.height || 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('No 2D canvas');
  const cameraTrack = camera.getVideoTracks()[0];
  let current = bubble;
  let failed = false;

  const draw = () => {
    try {
      const fit = fitRect(screenVideo.videoWidth, screenVideo.videoHeight, W, H);
      if (fit.width !== W || fit.height !== H) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, W, H);
      }
      ctx.drawImage(screenVideo, fit.x, fit.y, fit.width, fit.height);
      // A camera taken away mid-take leaves the screen alone rather than a frozen face.
      if (cameraTrack?.readyState !== 'live' || !cameraVideo.videoWidth) return;
      const { x, y, d } = bubbleRect(W, H, current);
      const r = d / 2;
      const crop = squareCrop(cameraVideo.videoWidth, cameraVideo.videoHeight);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(cameraVideo, crop.x, crop.y, crop.width, crop.height, x, y, d, d);
      ctx.restore();
      const ring = Math.max(2, Math.round(d * RING_SHARE));
      ctx.beginPath();
      ctx.arc(x + r, y + r, r - ring / 2, 0, Math.PI * 2);
      ctx.lineWidth = ring;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
    } catch (error) {
      if (!failed) console.error('Klipkord: could not draw the camera bubble', error);
      failed = true;
    }
  };

  // A canvas stream has no frame until something is drawn.
  draw();
  const stopTicks = tick(FPS, draw);
  const track = canvas.captureStream(FPS).getVideoTracks()[0];
  if (!track) {
    stopTicks();
    throw new Error('No canvas stream');
  }

  return {
    track,
    setBubble(next) {
      current = next;
    },
    stop() {
      stopTicks();
      track.stop();
      screenVideo.srcObject = null;
      cameraVideo.srcObject = null;
    },
  };
}
