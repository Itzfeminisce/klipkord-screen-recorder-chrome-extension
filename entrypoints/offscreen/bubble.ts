import { FLOATING_SIDE, SIZE_NAME, stepSize } from '@/lib/bubble';
import type { BubbleSize } from '@/lib/types';

interface DocumentPip {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}
const docPip = () => (window as Window & { documentPictureInPicture?: DocumentPip }).documentPictureInPicture;

export interface FloatingBubble {
  setSize(size: BubbleSize): void;
  close(): void;
}

const ICON = (path: string) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="${path}"></path></svg>`;
const MOVE = ICON('M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3');
const MINUS = ICON('M5 12h14');
const PLUS = ICON('M12 5v14M5 12h14');

const STYLE = `
body { margin: 0; height: 100vh; overflow: hidden; background: transparent; font-family: Geist, system-ui, sans-serif; }
.cam { position: absolute; inset: 8px; border-radius: 50%; border: 4px solid #FFFFFF; box-sizing: border-box; overflow: hidden; background: #D8C3B0; box-shadow: 0 12px 32px rgba(16,16,20,0.35); }
.cam video { width: 100%; height: 100%; object-fit: cover; display: block; }
.ctl { opacity: 0; transition: opacity 120ms; }
body:hover .ctl, body:focus-within .ctl { opacity: 1; }
.move { position: absolute; left: 50%; top: 2px; margin-left: -22px; width: 44px; height: 24px; border-radius: 12px; background: #111114; color: #F6F6F7; display: flex; align-items: center; justify-content: center; }
.bar { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; padding: 4px; border-radius: 12px; background: #111114; box-shadow: 0 8px 24px rgba(16,16,20,0.3); }
.step { width: 44px; height: 36px; border: none; border-radius: 8px; background: #26262B; color: #F6F6F7; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.step:disabled { opacity: 0.5; cursor: default; }
.size { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 11px; color: #D4D5DA; padding: 0 6px; }
.hide { height: 36px; padding: 0 12px; border: none; border-radius: 8px; background: #F6F6F7; color: #111114; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.drag { position: absolute; left: 50%; bottom: 60px; transform: translateX(-50%); white-space: nowrap; font-size: 12px; color: #1F2937; background: rgba(255,255,255,0.85); padding: 3px 10px; border-radius: 999px; }
`;

const BODY = `
<div class="cam"><video muted autoplay playsinline></video></div>
<span class="ctl move" aria-hidden="true">${MOVE}</span>
<span class="ctl drag">Drag to move</span>
<div class="ctl bar" role="toolbar" aria-label="Camera bubble controls">
  <button type="button" class="step" data-step="-1" aria-label="Smaller bubble">${MINUS}</button>
  <span class="size"></span>
  <button type="button" class="step" data-step="1" aria-label="Larger bubble">${PLUS}</button>
  <button type="button" class="hide" aria-label="Hide camera bubble">Hide</button>
</div>`;

/**
 * Opens the round camera in a Document Picture-in-Picture window that floats above every app, so a window or
 * screen capture records it where the user dragged it. Call it straight from a click: requestWindow needs one.
 * Resolves null when the camera can't open; the window is closed again.
 */
export async function openFloatingBubble(
  size: BubbleSize,
  openCamera: () => Promise<MediaStream | null>,
  on: { resized(size: BubbleSize): void; closed(): void },
): Promise<FloatingBubble | null> {
  const pip = docPip();
  if (!pip) throw new Error('Document Picture-in-Picture is not available');
  // requestWindow runs before the camera prompt, while the click still counts.
  const win = await pip.requestWindow({ width: FLOATING_SIDE[size], height: FLOATING_SIDE[size] });
  const camera = await openCamera();
  if (!camera) {
    win.close();
    return null;
  }
  const d = win.document;
  d.title = 'Camera bubble';
  const style = d.createElement('style');
  style.textContent = STYLE;
  d.head.append(style);
  d.body.innerHTML = BODY;
  d.querySelector('video')!.srcObject = camera;
  const label = d.querySelector<HTMLElement>('.size')!;
  const steps = [...d.querySelectorAll<HTMLButtonElement>('.step')];
  let current = size;
  let closed = false;

  const paint = () => {
    label.textContent = SIZE_NAME[current];
    for (const b of steps) b.disabled = stepSize(current, Number(b.dataset.step) as 1 | -1) === current;
  };
  const setSize = (next: BubbleSize) => {
    current = next;
    paint();
    const side = FLOATING_SIDE[next];
    try {
      // resizeTo takes the outer size; keep the frame Chrome draws around the page.
      win.resizeTo(side + win.outerWidth - win.innerWidth, side + win.outerHeight - win.innerHeight);
    } catch (error) {
      console.error('Klipkord: could not resize the camera bubble', error);
    }
  };
  for (const b of steps) {
    b.addEventListener('click', () => {
      const next = stepSize(current, Number(b.dataset.step) as 1 | -1);
      if (next === current) return;
      setSize(next);
      on.resized(next);
    });
  }
  d.querySelector('.hide')!.addEventListener('click', () => win.close());
  win.addEventListener('pagehide', () => {
    if (closed) return;
    closed = true;
    camera.getTracks().forEach((t) => t.stop());
    on.closed();
  });
  paint();

  return {
    setSize(next) {
      if (!closed && next !== current) setSize(next);
    },
    close() {
      camera.getTracks().forEach((t) => t.stop());
      win.close();
    },
  };
}
