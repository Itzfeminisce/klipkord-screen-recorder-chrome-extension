import { ringAt, smoothPoint, type Pt } from '@/lib/draw';

// Injected with `scripting` into the recorded tab only; never declared, so it runs nowhere else.
export default defineContentScript({
  registration: 'runtime',
  main() {
    const scope = globalThis as { klipkordDraw?: { remove: () => void } };
    if (scope.klipkordDraw) return;
    scope.klipkordDraw = mountOverlay(() => delete scope.klipkordDraw);
  },
});

type Tool = 'pen' | 'highlighter' | null;
interface Stroke { tool: 'pen' | 'highlighter'; color: string; points: Pt[] }

const ORANGE = '#C2410C';
const HIGHLIGHT = '#FACC15';

const ICON = {
  grip: '<svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="3" r="1.4"></circle><circle cx="10" cy="3" r="1.4"></circle><circle cx="4" cy="9" r="1.4"></circle><circle cx="10" cy="9" r="1.4"></circle><circle cx="4" cy="15" r="1.4"></circle><circle cx="10" cy="15" r="1.4"></circle></svg>',
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19l-4 1zM14 7l3 3"></path>',
  highlighter: '<path d="M9 3l6 6-6 8-4 1 1-4zM4 21h16"></path>',
  rings: '<circle cx="12" cy="12" r="3"></circle><circle cx="12" cy="12" r="8"></circle>',
  clear: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"></path>',
};
const svg = (size: number, body: string) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Draws over the page and listens only for pointer positions; it never reads the page. */
function mountOverlay(onRemove: () => void): { remove: () => void } {
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'closed' });

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;touch-action:none;cursor:crosshair';
  const ctx = canvas.getContext('2d')!;

  let tool: Tool = 'pen';
  let rings = true;
  const color = ORANGE;
  const strokes: Stroke[] = [];
  let live: Stroke | null = null;
  const clicks: { x: number; y: number; at: number }[] = [];
  let frame = 0;

  function size() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint();
  }

  function paintStroke(s: Stroke) {
    if (!s.points.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.tool === 'pen' ? s.color : HIGHLIGHT;
    ctx.lineWidth = s.tool === 'pen' ? 4 : 18;
    ctx.globalAlpha = s.tool === 'pen' ? 1 : 0.45;
    ctx.beginPath();
    const [first, ...rest] = s.points;
    ctx.moveTo(first!.x, first!.y);
    if (!rest.length) ctx.lineTo(first!.x + 0.01, first!.y);
    for (const p of rest) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
  }

  function paint() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const s of strokes) paintStroke(s);
    if (live) paintStroke(live);
    const now = performance.now();
    for (let i = clicks.length - 1; i >= 0; i--) {
      const c = clicks[i]!;
      const ring = ringAt(now - c.at);
      if (!ring) { clicks.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = ring.opacity;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.y, ring.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = ring.opacity * 0.35;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function animate() {
    paint();
    frame = clicks.length ? requestAnimationFrame(animate) : 0;
  }

  function ring(x: number, y: number) {
    clicks.push({ x, y, at: performance.now() });
    if (!frame) frame = requestAnimationFrame(animate);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!tool) return;
    canvas.setPointerCapture(e.pointerId);
    live = { tool, color, points: [{ x: e.clientX, y: e.clientY }] };
    if (rings) ring(e.clientX, e.clientY);
    paint();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!live) return;
    live.points.push(smoothPoint(live.points[live.points.length - 1], { x: e.clientX, y: e.clientY }));
    paint();
  });
  const finish = () => {
    if (live) strokes.push(live);
    live = null;
    paint();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  // Clicks on the page itself, while no pen is out: only the position is used.
  const onPageClick = (e: PointerEvent) => {
    if (!rings || tool || e.composedPath().includes(host)) return;
    ring(e.clientX, e.clientY);
  };
  window.addEventListener('pointerdown', onPageClick, { capture: true, passive: true });

  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:14px;background:#1F1F24;border:1px solid #333338;box-shadow:0 8px 24px rgba(16,16,20,0.25);pointer-events:auto;font-family:Geist,system-ui,sans-serif';

  const grip = document.createElement('span');
  grip.setAttribute('aria-hidden', 'true');
  grip.innerHTML = ICON.grip;
  grip.style.cssText = 'width:24px;height:44px;display:flex;align-items:center;justify-content:center;color:#8A8B93;cursor:grab;touch-action:none';

  const BUTTON = 'width:44px;height:44px;border:none;border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0';
  function button(label: string, html: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = html;
    return b;
  }
  const pen = button('Pen', svg(20, ICON.pen));
  const highlighter = button('Highlighter', svg(20, ICON.highlighter));
  const ringsButton = button('Click rings', svg(20, ICON.rings));
  const divider = document.createElement('span');
  divider.style.cssText = 'width:1px;height:28px;background:#3A3A40;margin:0 4px';
  const colour = button('Colour: orange', `<span style="width:24px;height:24px;border-radius:50%;background:${ORANGE};border:2px solid #F6F6F7;box-sizing:border-box"></span>`);
  colour.style.cssText = `${BUTTON};background:transparent`;
  const clear = button('Clear all drawings', `${svg(18, ICON.clear)}Clear`);
  clear.style.cssText = 'height:44px;padding:0 12px;border:none;border-radius:10px;background:transparent;color:#F6F6F7;font:inherit;font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;cursor:pointer';

  function render() {
    const toolStyle = (on: boolean) => `${BUTTON};background:${on ? '#F6F6F7' : 'transparent'};color:${on ? '#111114' : '#F6F6F7'}`;
    pen.style.cssText = toolStyle(tool === 'pen');
    pen.setAttribute('aria-pressed', String(tool === 'pen'));
    highlighter.style.cssText = toolStyle(tool === 'highlighter');
    highlighter.setAttribute('aria-pressed', String(tool === 'highlighter'));
    ringsButton.style.cssText = `${BUTTON};background:${rings ? '#3B1D12' : 'transparent'};color:${rings ? '#FDBA8C' : '#F6F6F7'}`;
    ringsButton.setAttribute('aria-pressed', String(rings));
    // With no pen out the page takes clicks again.
    canvas.style.pointerEvents = tool ? 'auto' : 'none';
  }
  pen.addEventListener('click', () => { tool = tool === 'pen' ? null : 'pen'; render(); });
  highlighter.addEventListener('click', () => { tool = tool === 'highlighter' ? null : 'highlighter'; render(); });
  ringsButton.addEventListener('click', () => { rings = !rings; render(); });
  clear.addEventListener('click', () => { strokes.length = 0; live = null; paint(); });

  let drag: { x: number; y: number; left: number; top: number } | null = null;
  grip.addEventListener('pointerdown', (e) => {
    const r = bar.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const left = Math.min(Math.max(0, drag.left + e.clientX - drag.x), window.innerWidth - bar.offsetWidth);
    const top = Math.min(Math.max(0, drag.top + e.clientY - drag.y), window.innerHeight - bar.offsetHeight);
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.style.bottom = 'auto';
    bar.style.transform = 'none';
  });
  grip.addEventListener('pointerup', () => { drag = null; });

  bar.append(grip, pen, highlighter, ringsButton, divider, colour, clear);
  root.append(canvas, bar);
  render();
  document.documentElement.append(host);
  window.addEventListener('resize', size);
  size();

  return {
    remove() {
      window.removeEventListener('resize', size);
      window.removeEventListener('pointerdown', onPageClick, { capture: true });
      if (frame) cancelAnimationFrame(frame);
      host.remove();
      onRemove();
    },
  };
}
