import type { BubbleSize, Corner, Settings } from './types';

export type Bubble = Settings['bubble'];
export interface Rect { x: number; y: number; width: number; height: number }
export interface Circle { x: number; y: number; d: number }   // top-left of the square that holds it

/** Bubble diameter as a share of the frame's shorter side. */
export const BUBBLE_SHARE: Record<BubbleSize, number> = { S: 0.24, M: 0.36, L: 0.48 };
/** Gap between the bubble and the frame edges, as a share of the shorter side. */
export const MARGIN_SHARE = 0.037;
/** White ring around the bubble, as a share of its diameter (the frames draw 3px on 72px). */
export const RING_SHARE = 0.04;

export const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
export const SIZES: BubbleSize[] = ['S', 'M', 'L'];

/** Where the round bubble sits in a frame of this size; `margin` in px, default from MARGIN_SHARE. */
export function bubbleRect(width: number, height: number, bubble: Bubble, margin?: number): Circle {
  const short = Math.max(0, Math.min(width, height));
  const gap = Math.round(margin ?? short * MARGIN_SHARE);
  // Never wider than the frame minus both margins.
  const d = Math.max(0, Math.min(Math.round(short * BUBBLE_SHARE[bubble.size]), short - 2 * gap));
  const left = bubble.corner.endsWith('left');
  const top = bubble.corner.startsWith('top');
  return { x: left ? gap : width - gap - d, y: top ? gap : height - gap - d, d };
}

/** Centred square crop of a camera frame, so a round clip shows the face without stretching. */
export function squareCrop(width: number, height: number): Rect {
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, width: side, height: side };
}

/** Fits a source inside the output keeping its shape (letterbox), for a screen that changes size mid-take. */
export function fitRect(srcW: number, srcH: number, outW: number, outH: number): Rect {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, width: outW, height: outH };
  const scale = Math.min(outW / srcW, outH / srcH);
  const width = Math.round(srcW * scale);
  const height = Math.round(srcH * scale);
  return { x: Math.round((outW - width) / 2), y: Math.round((outH - height) / 2), width, height };
}
