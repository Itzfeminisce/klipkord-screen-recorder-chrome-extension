import { useState } from 'react';
import { editComment, newComment, resolveComment, resolvedLabel, splitComments } from '@/lib/comments';
import { formatClock } from '@/lib/time';
import type { Comment } from '@/lib/types';
import { ReviewShell, type ReviewContext } from '../components/Player';
import { dayAndTime } from './Home';

const MONO = "var(--mono, 'Geist Mono', monospace)";

export default function ReviewComments() {
  return <ReviewShell tab="ReviewComments">{(ctx) => <Comments {...ctx} />}</ReviewShell>;
}

function Card({ comment, onSeek, onResolve, onEdit }: { comment: Comment; onSeek: () => void; onResolve: () => void; onEdit: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  const finish = () => { onEdit(draft); setEditing(false); };
  return (
    <div style={{ padding: 14, borderRadius: 14, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={onSeek}
          style={{ padding: '2px 6px', border: 'none', borderRadius: 6, background: '#FFF1EA', color: '#C2410C', fontFamily: MONO, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>{formatClock(comment.at)}</button>
        <span style={{ fontSize: 12, color: '#6E7079' }}>{dayAndTime(comment.createdAt)}</span>
      </div>
      {editing ? (
        <input type="text" aria-label="Edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') finish(); if (e.key === 'Escape') { setDraft(comment.text); setEditing(false); } }}
          style={{ height: 40, padding: '0 10px', borderRadius: 10, border: '1px solid #DCDCE0', font: 'inherit', fontSize: 14, color: '#111114', boxSizing: 'border-box' }} />
      ) : (
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{comment.text}</p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onResolve}
          style={{ height: 32, padding: '0 12px', border: '1px solid #E8E8EB', borderRadius: 8, background: '#FFFFFF', font: 'inherit', fontSize: 12, fontWeight: 600, color: '#111114', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>Resolve
        </button>
        <button type="button" onClick={() => (editing ? finish() : (setDraft(comment.text), setEditing(true)))}
          style={{ height: 32, padding: '0 12px', border: 'none', borderRadius: 8, background: 'transparent', font: 'inherit', fontSize: 12, fontWeight: 500, color: '#5F6168', cursor: 'pointer' }}>Edit</button>
      </div>
    </div>
  );
}

function Comments({ rec, now, seek, setComments }: ReviewContext) {
  const [text, setText] = useState('');
  const { open, resolved } = splitComments(rec.comments);
  const at = formatClock(now);

  function add() {
    const c = newComment(now, text, crypto.randomUUID(), Date.now());
    if (!c) return;
    setComments([...rec.comments, c]);
    setText('');
  }

  return (
    <>
      <div style={{ flexGrow: 1, minHeight: 0, overflow: 'auto', padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {open.map((c) => (
          <Card key={c.id} comment={c} onSeek={() => seek(c.at)} onResolve={() => setComments(resolveComment(rec.comments, c.id))}
            onEdit={(t) => setComments(editComment(rec.comments, c.id, t))} />
        ))}
        {resolved.length > 0 && (
          <details style={{ borderRadius: 14, background: '#FFFFFF', border: '1px solid #E8E8EB' }}>
            <summary style={{ padding: '12px 14px', fontSize: 13, fontWeight: 500, color: '#5F6168', cursor: 'pointer' }}>{resolvedLabel(resolved.length)}</summary>
            {resolved.map((c) => (
              <div key={c.id} style={{ padding: '0 14px 14px', fontSize: 13, lineHeight: 1.5, color: '#5F6168' }}>
                <button type="button" onClick={() => seek(c.at)} style={{ padding: 0, border: 'none', background: 'none', color: 'inherit', fontFamily: MONO, fontSize: 12, cursor: 'pointer' }}>{formatClock(c.at)}</button> · {c.text}
              </div>
            ))}
          </details>
        )}
        <span style={{ fontSize: 12, color: '#6E7079' }}>Only you can see these comments.</span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); add(); }} style={{ padding: '12px 16px 16px', display: 'flex', gap: 8, borderTop: '1px solid #E8E8EB', background: '#FFFFFF' }}>
        <label style={{ flexGrow: 1, display: 'flex' }}>
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Comment at {at}</span>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Comment at ${at}`}
            style={{ width: '100%', height: 44, padding: '0 12px', borderRadius: 12, border: '1px solid #DCDCE0', background: '#FFFFFF', font: 'inherit', fontSize: 14, color: '#111114', boxSizing: 'border-box' }} />
        </label>
        <button type="submit"
          style={{ height: 44, padding: '0 16px', border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Add</button>
      </form>
    </>
  );
}
