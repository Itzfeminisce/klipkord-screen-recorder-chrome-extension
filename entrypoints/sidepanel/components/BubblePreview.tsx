import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CORNERS, SIZES, bubbleRect, type Bubble } from '@/lib/bubble';
import { getSettings, onSettingsChanged } from '@/lib/settings';
import type { Corner, Settings } from '@/lib/types';

/** Opens the camera while shown, for the bubble preview; `busy` when another app holds it. Stops on leave. */
export function useCamera(enabled: boolean) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let opened: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 } }).then(
      (s) => {
        if (!live) return s.getTracks().forEach((t) => t.stop());
        opened = s;
        setBusy(false);
        setStream(s);
      },
      (error: { name?: string }) => {
        if (!live) return;
        // Chrome reports a camera held by another app as NotReadableError (TrackStartError on older builds).
        if (error.name === 'NotReadableError' || error.name === 'TrackStartError' || error.name === 'AbortError') setBusy(true);
        else console.error('Klipkord: could not open the camera', error);
      },
    );
    return () => {
      live = false;
      opened?.getTracks().forEach((t) => t.stop());
      setStream(null);
      setBusy(false);
    };
  }, [enabled]);
  return { stream, busy };
}

function CameraFace({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch((error) => console.error('Klipkord: could not play the camera preview', error));
  }, [stream]);
  return <video ref={ref} muted playsInline aria-hidden="true" style={{ width: '100%', height: '100%', objectFit: 'cover', display: stream ? 'block' : 'none' }} />;
}

/** Tracks an element's size, so the bubble is placed with the same maths as the recording. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * Screen sketch with the round bubble at its corner and size. `compact` is the small one beside the
 * Recording clock; the full one is Home's 196px preview.
 */
export function BubblePreview({ bubble, camera, stream, compact }: { bubble: Bubble; camera: boolean; stream: MediaStream | null; compact?: boolean }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const { x, y, d } = bubbleRect(size.width, size.height, bubble, compact ? 8 : 26);
  const ring = compact ? 2 : 3;
  const face = camera && size.width > 0 && (
    <span style={{ position: 'absolute', left: x, top: y, width: d, height: d, borderRadius: '50%', background: '#F2C9A8', border: `${ring}px solid #FFFFFF`, boxSizing: 'border-box', overflow: 'hidden' }}>
      <CameraFace stream={stream} />
    </span>
  );
  if (compact) {
    return <div ref={ref} style={{ flexGrow: 1, height: 72, borderRadius: 10, background: '#26262B', position: 'relative', overflow: 'hidden' }}>{face}</div>;
  }
  return (
    <div ref={ref} style={{ margin: '12px 24px 0', aspectRatio: '16 / 9', borderRadius: 16, background: '#111114', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 16, top: 16, right: 16, bottom: 16, borderRadius: 8, background: '#26262B', padding: 14, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ width: '55%', height: 8, borderRadius: 4, background: '#3A3A41' }} />
        <span style={{ width: '78%', height: 8, borderRadius: 4, background: '#3A3A41' }} />
        <span style={{ width: '40%', height: 8, borderRadius: 4, background: '#3A3A41' }} />
      </div>
      {face}
      <span style={{ position: 'absolute', left: 26, bottom: 24, padding: '4px 8px', borderRadius: 6, background: 'rgba(17,17,20,0.72)', color: '#FFFFFF', fontSize: 11, fontWeight: 500 }}>Preview</span>
    </div>
  );
}

const CORNER_LABEL: Record<Corner, string> = { 'top-left': 'Top left', 'top-right': 'Top right', 'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right' };
const GROUP: CSSProperties = { display: 'flex', padding: 3, borderRadius: 9, background: '#EBEBEE' };
const chosen = (on: boolean): CSSProperties => (on ? { background: '#FFFFFF', boxShadow: '0 1px 2px rgba(16,16,20,0.08)' } : { background: 'transparent' });

/** "Bubble" corner (4) and size (S, M, L) pickers under Home's preview. */
export function BubbleControls({ bubble, onChange }: { bubble: Bubble; onChange: (patch: Partial<Bubble>) => void }) {
  return (
    <div style={{ margin: '10px 24px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: '#5F6168' }}>Bubble</span>
      <div role="radiogroup" aria-label="Bubble corner" style={{ ...GROUP, gap: 4 }}>
        {CORNERS.map((corner) => {
          const on = bubble.corner === corner;
          const dot: CSSProperties = {
            position: 'absolute', width: 6, height: 6, borderRadius: '50%', background: on ? '#C2410C' : '#6E7079',
            [corner.endsWith('left') ? 'left' : 'right']: 7, [corner.startsWith('top') ? 'top' : 'bottom']: 7,
          };
          return (
            <button key={corner} type="button" role="radio" aria-checked={on} aria-label={CORNER_LABEL[corner]} onClick={() => onChange({ corner })}
              style={{ width: 28, height: 28, border: 'none', borderRadius: 6, position: 'relative', cursor: 'pointer', ...chosen(on) }}>
              <span style={dot} />
            </button>
          );
        })}
      </div>
      <div role="radiogroup" aria-label="Bubble size" style={{ ...GROUP, gap: 2, marginLeft: 'auto' }}>
        {SIZES.map((size) => {
          const on = bubble.size === size;
          return (
            <button key={size} type="button" role="radio" aria-checked={on} onClick={() => onChange({ size })}
              style={{ height: 28, padding: '0 10px', border: 'none', borderRadius: 6, font: 'inherit', fontSize: 12, cursor: 'pointer', ...chosen(on), ...(on ? { fontWeight: 600, color: '#111114' } : { color: '#5F6168' }) }}>
              {size}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The small preview beside the Recording clock, with the bubble where the video has it. */
export function LiveBubblePreview() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    getSettings().then(setSettings, (error) => console.error('Klipkord: could not read settings', error));
    return onSettingsChanged(setSettings);
  }, []);
  const on = Boolean(settings?.capture.camera);
  const camera = useCamera(on);
  if (!settings) return <div style={{ flexGrow: 1, height: 72, borderRadius: 10, background: '#26262B' }} />;
  return <BubblePreview compact bubble={settings.bubble} camera={on && !camera.busy} stream={camera.stream} />;
}
