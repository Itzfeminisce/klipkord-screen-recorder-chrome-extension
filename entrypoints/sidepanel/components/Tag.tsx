import type { MarkerKind } from '@/lib/types';

/** Pill for a marker kind; the label comes from the frame that shows it. `onDark` for the dark panel. */
export function Tag({ kind, onDark, children }: { kind: MarkerKind; onDark?: boolean; children: string }) {
  return <span className={`tag tag-${kind}${onDark ? ' tag-on-dark' : ''}`}>{children}</span>;
}
