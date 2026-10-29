import type { CSSProperties, ReactNode } from 'react';
import { speedLabel } from '@/lib/player';

const MONO = "var(--mono, 'Geist Mono', monospace)";
const icon = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, viewBox: '0 0 24 24' } as const;
const PLAY = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5l12 7-12 7z" /></svg>;
const PAUSE = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>;

export interface ControlProps {
  playing: boolean;
  onToggle: () => void;
  time: string;
  chapter?: string;
  speed: number;
  onSpeed: () => void;
  muted: boolean;
  onVolume: () => void;
}

function btn(size: number, radius: number): CSSProperties {
  return { width: size, height: size, border: 'none', borderRadius: radius, background: 'transparent', color: '#F6F6F7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, cursor: 'pointer' };
}

function Volume({ muted, onVolume, size, radius, glyph }: { muted: boolean; onVolume: () => void; size: number; radius: number; glyph: number }) {
  return (
    <button type="button" aria-label="Volume" aria-pressed={muted} onClick={onVolume} style={{ ...btn(size, radius), opacity: muted ? 0.5 : 1 }}>
      <svg width={glyph} height={glyph} {...icon}><path d="M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7" /></svg>
    </button>
  );
}

/** The compact row under the timeline in Review and its sibling screens. */
export function ControlRow(p: ControlProps & { onFullScreen: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '0 -6px' }}>
      <button type="button" aria-label={p.playing ? 'Pause' : 'Play'} onClick={p.onToggle} style={btn(32, 8)}>
        <span style={{ width: 14, height: 14, display: 'flex' }}>{p.playing ? PAUSE : PLAY}</span>
      </button>
      <span style={{ fontFamily: MONO, fontSize: 11, color: '#D4D5DA', whiteSpace: 'nowrap' }}>{p.time}</span>
      <span style={{ flexGrow: 1, minWidth: 0, fontSize: 11, color: '#9A9BA3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingLeft: 4 }}>{p.chapter}</span>
      <button type="button" aria-label="Playback speed" onClick={p.onSpeed}
        style={{ height: 32, padding: '0 8px', border: 'none', borderRadius: 8, background: 'transparent', color: '#F6F6F7', fontFamily: MONO, fontSize: 11, flexShrink: 0, cursor: 'pointer' }}>{speedLabel(p.speed)}</button>
      <Volume muted={p.muted} onVolume={p.onVolume} size={32} radius={8} glyph={16} />
      <button type="button" aria-label="Full screen" title="Full screen" onClick={p.onFullScreen} style={btn(32, 8)}>
        <svg width={16} height={16} {...icon}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
      </button>
    </div>
  );
}

interface OverlayProps extends ControlProps {
  title: string;
  timeline: ReactNode;
  visible: boolean;
  captionsOn: boolean;
  onCaptions: () => void;
  onExit: () => void;
}

/** Title bar and bottom controls drawn over the full-screen recording. */
export function FullscreenOverlay(p: OverlayProps) {
  const fade: CSSProperties = { opacity: p.visible ? 1 : 0, pointerEvents: p.visible ? 'auto' : 'none', transition: 'opacity 150ms' };
  return (
    <>
      <div style={{ ...fade, position: 'absolute', left: 0, right: 0, top: 0, padding: '20px 28px', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0))', color: '#F6F6F7' }}>
        <span style={{ flexGrow: 1, minWidth: 0, fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</span>
        <span style={{ fontSize: 13, color: '#D4D5DA' }}>
          Press <span style={{ fontFamily: MONO, padding: '1px 6px', borderRadius: 4, background: '#2C2C32', color: '#F6F6F7' }}>Esc</span> to leave full screen
        </span>
      </div>
      <div style={{ ...fade, position: 'absolute', left: 0, right: 0, bottom: 0, padding: '0 28px 20px', display: 'flex', flexDirection: 'column', gap: 10, background: 'linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.7))', color: '#F6F6F7' }}>
        {p.timeline}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" aria-label={p.playing ? 'Pause' : 'Play'} onClick={p.onToggle} style={btn(44, 10)}>
            <span style={{ width: 20, height: 20, display: 'flex' }}>{p.playing ? PAUSE : PLAY}</span>
          </button>
          <span style={{ fontFamily: MONO, fontSize: 13, color: '#D4D5DA' }}>{p.time}</span>
          <span style={{ flexGrow: 1, minWidth: 0, paddingLeft: 8, fontSize: 13, color: '#9A9BA3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.chapter}</span>
          <button type="button" aria-label="Playback speed" onClick={p.onSpeed}
            style={{ height: 44, padding: '0 12px', border: 'none', borderRadius: 10, background: 'transparent', color: '#F6F6F7', fontFamily: MONO, fontSize: 13, cursor: 'pointer' }}>{speedLabel(p.speed)}</button>
          <Volume muted={p.muted} onVolume={p.onVolume} size={44} radius={10} glyph={20} />
          <button type="button" aria-label="Captions" aria-pressed={p.captionsOn} onClick={p.onCaptions} style={{ ...btn(44, 10), opacity: p.captionsOn ? 1 : 0.6 }}>
            <svg width={20} height={20} {...icon}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3" /></svg>
          </button>
          <button type="button" aria-label="Exit full screen" title="Exit full screen" onClick={p.onExit} style={btn(44, 10)}>
            <svg width={20} height={20} {...icon}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
          </button>
        </div>
      </div>
    </>
  );
}
