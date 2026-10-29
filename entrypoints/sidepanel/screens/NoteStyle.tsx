import { useEffect, useState } from 'react';
import { useRouter } from '../router';
import { getRecording } from '@/lib/db';
import { NOTE_STYLES, STYLE_BLURB } from '@/lib/notes/style';
import { startNotes } from '@/lib/notes/summarize';
import { getSettings, updateSettings } from '@/lib/settings';
import type { NoteStyle as Style, Recording } from '@/lib/types';
import { useNotesJob } from '../components/NotesBody';
import { STYLE_NAMES } from './Home';

export default function NoteStyle() {
  const { route, navigate, back, canGoBack } = useRouter();
  const id = route.params.recordingId;
  const progress = useNotesJob(id);
  const [rec, setRec] = useState<Recording | null>(null);
  const [always, setAlways] = useState<Style | undefined>(undefined);
  const [picked, setPicked] = useState<Style | undefined>(undefined);

  useEffect(() => {
    if (id) getRecording(id).then((r) => setRec(r ?? null), (error) => console.error('Klipkord: could not load the recording', error));
    getSettings().then((s) => setAlways(s.defaultStyle), (error) => console.error('Klipkord: could not read the settings', error));
  }, [id]);

  const detected = rec?.summary?.detected;
  const current = picked ?? progress?.style ?? rec?.summary?.style;

  // Choosing a style rewrites the notes; the transcript and comments are not touched.
  function choose(style: Style) {
    if (!id || style === current) return;
    setPicked(style);
    void startNotes(id, { style });
    if (always) save(style);
  }

  function save(style: Style | undefined) {
    setAlways(style);
    updateSettings({ defaultStyle: style }).catch((error) => console.error('Klipkord: could not save the default style', error));
  }

  const close = () => (canGoBack ? back() : navigate('Review', { recordingId: id }));

  return (
    <main className="screen" style={{ minHeight: '100vh', background: '#55565C', color: '#111114' }}>
      <button type="button" aria-label="Close" onClick={close} style={{ flexGrow: 1, display: 'block', border: 'none', background: 'none', cursor: 'pointer' }} />
      <div role="dialog" aria-label="Note style" style={{ borderRadius: '24px 24px 0 0', background: '#FFFFFF', padding: '10px 24px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 999, background: '#DCDCE0' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>How should the notes be written?</h1>
          {detected && (
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#5F6168' }}>
              Klipkord picked {STYLE_NAMES[detected]} from what you said and marked. Pick another and the notes are rewritten.
            </p>
          )}
        </div>
        <div role="radiogroup" aria-label="Note style" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {NOTE_STYLES.map((style) => {
            const on = style === current;
            return (
              <button key={style} type="button" role="radio" aria-checked={on} onClick={() => choose(style)}
                style={{ padding: 12, borderRadius: 12, border: on ? '2px solid #C2410C' : '1px solid #E8E8EB', background: on ? '#FFF8F4' : '#FFFFFF', color: '#111114', font: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', border: on ? '5px solid #C2410C' : '2px solid #9A9BA3', boxSizing: 'border-box', flexShrink: 0, marginTop: 1 }} />
                <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{STYLE_NAMES[style]}</span>
                    {style === detected && <span style={{ padding: '1px 6px', borderRadius: 999, background: '#FFF1EA', color: '#9A3412', fontSize: 11, fontWeight: 600 }}>Detected</span>}
                  </span>
                  <span style={{ fontSize: 12, lineHeight: 1.45, color: '#5F6168' }}>{STYLE_BLURB[style]}</span>
                </span>
              </button>
            );
          })}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#44464D' }}>
          <input type="checkbox" checked={always !== undefined} disabled={!current} onChange={(e) => save(e.target.checked ? current : undefined)}
            style={{ width: 18, height: 18, accentColor: '#C2410C', margin: 0 }} />
          Always use this style
        </label>
        <button type="button" onClick={close}
          style={{ height: 48, border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Done</button>
        <span style={{ textAlign: 'center', fontSize: 12, color: '#6E7079' }}>Your transcript and comments stay as they are.</span>
      </div>
    </main>
  );
}
