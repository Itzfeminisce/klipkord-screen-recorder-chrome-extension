import type { ReviewContext } from '../components/Player';
import NotesBody from '../components/NotesBody';
import { useRouter } from '../router';
import { STYLE_NAMES } from './Home';

const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

function StyleChip({ ctx }: { ctx: ReviewContext }) {
  const { navigate } = useRouter();
  const style = ctx.rec.summary?.style;
  if (!style) return null;
  return (
    <button type="button" onClick={() => navigate('NoteStyle', { recordingId: ctx.rec.id, atMs: ctx.now })}
      style={{ alignSelf: 'flex-start', flexShrink: 0, height: 32, padding: '0 10px', border: 'none', borderRadius: 999, background: '#FFF1EA', color: '#9A3412', font: 'inherit', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
      {STYLE_NAMES[style]}
      <svg width="12" height="12" viewBox="0 0 24 24" strokeWidth="2.4" {...stroke}><path d="M6 9l6 6 6-6" /></svg>
    </button>
  );
}

export const notesTab = (ctx: ReviewContext) => <NotesBody recordingId={ctx.rec.id} onSeek={ctx.seek} top={<StyleChip ctx={ctx} />} />;
