import type { CaptureMode } from './types';

/** What the picker closed on, saved for the side panel. A tab's fields come from the tab the person came from. */
export type RecordedSource =
  | { kind: 'tab'; title: string; url: string; favIconUrl?: string }
  | { kind: 'window'; label: string }
  | { kind: 'screen'; label?: string };

export interface SourceChip {
  /** Which icon leads the chip; 'favicon' uses `iconUrl`. */
  icon: 'favicon' | 'tab' | 'window' | 'screen';
  iconUrl?: string;
  text: string;
  /** The full name for the title attribute. */
  title: string;
}

/** "localhost:3000" for http://localhost:3000/x; empty when the url is not one. */
export function addressOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

/** The source chip of Countdown, Recording and Paused; the mode's own label when nothing is known about the source. */
export function sourceChip(mode: CaptureMode | undefined, modeLabel: string, source: RecordedSource | null): SourceChip | null {
  if (!mode) return null;
  const fallback: SourceChip = { icon: mode, text: modeLabel, title: modeLabel };
  if (!source || source.kind !== mode) return fallback;
  if (source.kind === 'tab') {
    const address = addressOf(source.url);
    const name = source.title.trim() || address;
    if (!name) return fallback;
    return source.favIconUrl
      ? { icon: 'favicon', iconUrl: source.favIconUrl, text: name, title: name }
      : { icon: 'tab', text: address || name, title: address || name };
  }
  if (source.kind === 'window') {
    const name = source.label.trim();
    return name ? { icon: 'window', text: name, title: name } : fallback;
  }
  // Chrome's screen label is "screen:0:0"; it carries no count, so "Screen N of M" cannot be built from it.
  return { icon: 'screen', text: 'Whole screen', title: 'Whole screen' };
}
