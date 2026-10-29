import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getRecording } from '@/lib/db';
import { DriveError, cancelUpload, deleteFile, driveState, getShare, putShare, removeShare, shareAnyone, startUpload, stopSharing, uploadChunks, type Fetch, type Share } from '@/lib/drive';
import { encodeKept } from '@/lib/encode';
import { safeName, videoExt } from '@/lib/folder';
import { GOOGLE_ORIGINS, connectGoogle, forgetGoogleToken, getGoogleToken, googleConfigured } from '@/lib/googleAuth';
import { estimateVideoBytes } from '@/lib/library';
import { formatBytes } from '@/lib/time';
import type { Recording } from '@/lib/types';
import { videoStore } from '@/lib/videoStore';
import { Spinner } from '../components';
import { useRouter } from '../router';
import { BackBar } from './Export';

const MONO = "'Geist Mono', monospace";
const CARD: CSSProperties = { borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB' };
const OUTLINE: CSSProperties = { height: 44, border: '1px solid #E8E8EB', borderRadius: 12, background: '#FFFFFF', font: 'inherit', fontSize: 13, fontWeight: 500, color: '#111114', cursor: 'pointer' };
const SMALL: CSSProperties = { height: 36, padding: '0 14px', borderRadius: 10, font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const SMALL_DARK: CSSProperties = { ...SMALL, alignSelf: 'flex-start', border: 'none', background: '#111114', color: '#FFFFFF' };
const SMALL_OUTLINE: CSSProperties = { ...SMALL, border: '1px solid #E8E8EB', background: '#FFFFFF', color: '#111114', fontWeight: 500 };
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
// A wrapper, so fetch is never called with another object as `this`.
const FETCH: Fetch = (input, init) => fetch(input, init);
const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

type Phase =
  | { kind: 'loading' }
  | { kind: 'drive-connect' }
  | { kind: 'drive-uploading'; sent: number; total: number }
  | { kind: 'drive-upload-failed'; percent: number }
  | { kind: 'drive-offline' }
  | { kind: 'ready'; share: Share };

function StateCard({ tint, icon, title, body, children }: { tint: CSSProperties; icon: ReactNode; title: string; body: string; children: ReactNode }) {
  return (
    <div role="status" style={{ ...CARD, margin: '12px 16px 0', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <span style={{ width: 32, height: 32, borderRadius: '50%', ...tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} aria-hidden="true">{icon}</svg>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: '#5F6168' }}>{body}</span>
        </span>
      </div>
      {children}
    </div>
  );
}

const LINK_ICON = <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>;
const GREY: CSSProperties = { background: '#F1F1F3', color: '#44464D' };

export default function DriveLink() {
  const { route, back } = useRouter();
  const id = route.params.recordingId;
  const [rec, setRec] = useState<Recording | null | undefined>();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const blob = useRef<Blob | null>(null);
  const session = useRef<string | null>(null);
  const percent = useRef(0);
  const stop = useRef<AbortController | null>(null);
  const configured = googleConfigured();

  useEffect(() => {
    if (!id) return setRec(null);
    getRecording(id).then((r) => setRec(r ?? null), (error) => { console.error('Klipkord: could not load the recording', error); setRec(null); });
    return () => stop.current?.abort();
  }, [id]);

  useEffect(() => {
    if (rec) void begin();
  }, [rec]); // eslint-disable-line react-hooks/exhaustive-deps

  function fail(error: unknown) {
    console.error('Klipkord: could not share the video', error);
    if (error instanceof DriveError && (error.status === 404 || error.status === 410)) session.current = null;
    const state = driveState(error, navigator.onLine);
    if (state === 'drive-connect') void forgetGoogleToken().catch(() => undefined);
    setPhase(state === 'drive-upload-failed' ? { kind: state, percent: percent.current } : { kind: state });
  }

  async function begin(given?: string) {
    const r = rec;
    if (!r) return;
    if (!configured) {
      console.error('Klipkord: could not set up Google Drive', new Error('This build has no WXT_GOOGLE_CLIENT_ID'));
      return setPhase({ kind: 'drive-connect' });
    }
    try {
      const existing = await getShare(r.id);
      if (existing?.permissionId) return setPhase({ kind: 'ready', share: existing });
      if (!navigator.onLine) return setPhase({ kind: 'drive-offline' });
      const token = given ?? (await getGoogleToken());
      if (!token || !(await browser.permissions.contains({ origins: GOOGLE_ORIGINS }))) return setPhase({ kind: 'drive-connect' });
      if (existing) {
        try {
          return await shareFile(r, token, existing);
        } catch (error) {
          // Deleted in Drive since: upload a fresh copy.
          if (!(error instanceof DriveError && error.status === 404)) throw error;
          await removeShare(r.id);
        }
      }
      await upload(r, token);
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return;
      fail(error);
    }
  }

  async function shareFile(r: Recording, token: string, file: Share) {
    const permissionId = await shareAnyone(FETCH, token, file.fileId);
    const share = { ...file, permissionId };
    await putShare(r.id, share);
    setPhase({ kind: 'ready', share });
  }

  async function upload(r: Recording, token: string) {
    const abort = new AbortController();
    stop.current = abort;
    percent.current = 0;
    setPhase({ kind: 'drive-uploading', sent: 0, total: blob.current?.size ?? estimateVideoBytes(r) });
    if (!blob.current) {
      const video = r.edits.length > 0 ? await encodeKept(r, () => undefined, abort.signal) : await videoStore.read(r.id, 'video', r.mime);
      if (video.size === 0) throw new Error('The recording has no video');
      blob.current = video;
    }
    const data = blob.current;
    const name = `${safeName(r.title)}.${videoExt(r.mime)}`;
    const resume = session.current !== null;
    session.current ??= await startUpload(FETCH, token, { name, mimeType: (data.type || r.mime).split(';')[0]!, size: data.size });
    const file = await uploadChunks({ fetch: FETCH }, token, session.current, data, (sent) => {
      percent.current = Math.round((sent / data.size) * 100);
      setPhase({ kind: 'drive-uploading', sent, total: data.size });
    }, abort.signal, resume);
    session.current = null;
    // Kept before sharing, so Try again shares this file instead of uploading another.
    const uploaded: Share = { fileId: file.id, link: file.webViewLink, name, size: data.size };
    await putShare(r.id, uploaded);
    await shareFile(r, token, uploaded);
  }

  async function connect() {
    try {
      const token = await connectGoogle();
      await begin(token);
    } catch (error) {
      console.error('Klipkord: could not connect Google', error);
      if (!navigator.onLine) setPhase({ kind: 'drive-offline' });
    }
  }

  function cancel() {
    stop.current?.abort();
    if (session.current) void cancelUpload(FETCH, session.current);
    session.current = null;
    back();
  }

  async function withToken(share: Share, act: (token: string) => Promise<void>) {
    if (!rec) return;
    const token = await getGoogleToken();
    if (!token) return setPhase({ kind: 'drive-connect' });
    setBusy(true);
    try {
      await act(token);
      back();
    } catch (error) {
      console.error('Klipkord: could not change the Drive link', error);
      const state = driveState(error, navigator.onLine);
      if (state === 'drive-connect') { await forgetGoogleToken().catch(() => undefined); setPhase({ kind: state }); }
      else if (state === 'drive-offline') setPhase({ kind: state });
      else setPhase({ kind: 'ready', share });
    } finally {
      setBusy(false);
    }
  }

  const unshare = (share: Share) => withToken(share, async (token) => {
    if (share.permissionId) await stopSharing(FETCH, token, share.fileId, share.permissionId);
    await putShare(rec!.id, { ...share, permissionId: undefined });
  });
  const remove = (share: Share) => withToken(share, async (token) => {
    await deleteFile(FETCH, token, share.fileId);
    await removeShare(rec!.id);
  });
  const copy = (link: string) => navigator.clipboard.writeText(link).catch((error) => console.error('Klipkord: could not copy the link', error));

  if (rec === undefined) return <main className="screen screen-center"><Spinner /></main>;
  if (!rec) return <main className="screen screen-center"><BackBar label="Back" onBack={back} /></main>;

  const backLink = (label: string) => <button type="button" onClick={back} style={{ ...SMALL_OUTLINE, display: 'flex', alignItems: 'center' }}>{label}</button>;

  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      <BackBar label="Back" onBack={phase.kind === 'drive-uploading' ? cancel : back} title="Share a link" size={16} />

      {phase.kind === 'loading' && <div style={{ margin: '24px auto' }}><Spinner /></div>}

      {phase.kind === 'drive-connect' && (
        <StateCard tint={GREY} icon={LINK_ICON} title="Connect your Google account to share a link"
          body="Klipkord asks for the smallest permission Google has. It can only see files that Klipkord itself puts in your Drive. It cannot open, list or change anything else you have there.">
          <div style={{ padding: '10px 12px', borderRadius: 12, background: '#EBEBEE', fontSize: 12, lineHeight: 1.5, color: '#44464D' }}>Nothing is uploaded until you press Share. You can disconnect in Settings at any time.</div>
          {/* Without a client id in the build there is nothing to connect to. */}
          <button type="button" onClick={() => void connect()} disabled={!configured} style={{ ...SMALL_DARK, opacity: configured ? 1 : 0.5, cursor: configured ? 'pointer' : 'default' }}>Connect Google</button>
        </StateCard>
      )}

      {phase.kind === 'drive-uploading' && (
        <StateCard tint={{ background: '#FFF1EA', color: '#9A3412' }} icon={<path d="M12 16V5M7 10l5-5 5 5M5 20h14" />} title="Uploading to your Google Drive"
          body="One copy of the video is going up. Keep this panel open until it finishes.">
          <div role="progressbar" aria-label="Uploading to your Google Drive" aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase.total ? Math.round((phase.sent / phase.total) * 100) : 0} style={{ height: 8, borderRadius: 4, background: '#EBEBEE', overflow: 'hidden' }}>
            <div style={{ width: `${phase.total ? Math.min(100, (phase.sent / phase.total) * 100) : 0}%`, height: '100%', background: '#C2410C' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: MONO, fontSize: 12, color: '#6E7079' }}>{`${mb(phase.sent)} of ${mb(phase.total)} MB`}</span>
            <button type="button" onClick={cancel} style={SMALL_OUTLINE}>Cancel</button>
          </div>
        </StateCard>
      )}

      {phase.kind === 'drive-upload-failed' && (
        <StateCard tint={{ background: '#FEF2F2', color: '#B91C1C' }} icon={<><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></>} title="The upload didn’t finish"
          body={`Google stopped it at ${phase.percent}%. Nothing was shared, and no link was made. Your recording is safe on this computer.`}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => void begin()} style={SMALL_DARK}>Try again</button>
            {backLink('Back to saving')}
          </div>
        </StateCard>
      )}

      {phase.kind === 'drive-offline' && (
        <StateCard tint={GREY} icon={<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.4M12 20h.01" />} title="You’re offline"
          body="Sharing a link needs a connection. Saving to your computer and making a GIF still work.">
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => void begin()} style={SMALL_DARK}>Try again</button>
            {backLink('Save to your computer')}
          </div>
        </StateCard>
      )}

      {phase.kind === 'ready' && <Ready share={phase.share} busy={busy} onCopy={copy} onStop={() => void unshare(phase.share)} onDelete={() => void remove(phase.share)} />}
    </main>
  );
}

function Ready({ share, busy, onCopy, onStop, onDelete }: { share: Share; busy: boolean; onCopy: (link: string) => void; onStop: () => void; onDelete: () => void }) {
  return (
    <>
      <div style={{ margin: '12px 16px 0', display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#ECFDF3', color: '#166534', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 16, fontWeight: 600 }}>Link ready</span><span style={{ fontSize: 13, color: '#5F6168' }}>Your video is in your Google Drive.</span></span>
      </div>

      <div style={{ ...CARD, margin: '14px 16px 0', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label htmlFor="share-link" style={{ fontSize: 12, color: '#6E7079' }}>View link</label>
        <input id="share-link" type="text" readOnly value={share.link} onFocus={(e) => e.currentTarget.select()}
          style={{ height: 44, boxSizing: 'border-box', padding: '0 12px', border: '1px solid #E8E8EB', borderRadius: 10, background: '#F6F6F7', fontFamily: MONO, fontSize: 12, color: '#111114' }} />
        <button type="button" onClick={() => onCopy(share.link)} style={{ height: 48, border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Copy link</button>
      </div>

      <div style={{ ...CARD, margin: '10px 16px 0', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: 12, background: '#FFF1EA', color: '#9A3412', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 14, fontWeight: 600 }}>Anyone with the link can view</span><span style={{ fontSize: 12, lineHeight: 1.45, color: '#6E7079' }}>They can watch and download it. They can’t comment or edit. They don’t need a Google account.</span></span>
      </div>

      <div style={{ margin: '10px 16px 0', padding: '12px 14px', borderRadius: 12, background: '#EBEBEE', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#44464D' }}>What was uploaded</span>
        <span style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.6, color: '#44464D', wordBreak: 'break-word' }}>{`${share.name} · ${formatBytes(share.size)}`}</span>
        <span style={{ fontSize: 12, lineHeight: 1.5, color: '#44464D' }}>Only this one video, with your cuts applied. No notes, no transcript, nothing else from Klipkord. Klipkord can see only this file in your Drive.</span>
      </div>

      <div style={{ margin: '10px 16px 0' }}>
        <a href={share.link} target="_blank" rel="noreferrer" style={{ height: 44, border: '1px solid #E8E8EB', borderRadius: 12, background: '#FFFFFF', fontSize: 14, fontWeight: 500, color: '#111114', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          Open in Drive<svg width="14" height="14" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
        </a>
      </div>

      <div style={{ flexGrow: 1 }} />
      <div style={{ margin: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#5F6168' }}>Stop sharing</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <button type="button" onClick={onStop} disabled={busy} style={OUTLINE}>Stop sharing</button>
          <button type="button" onClick={onDelete} disabled={busy} style={{ ...OUTLINE, color: '#B91C1C' }}>Delete from Drive</button>
        </div>
        <span style={{ fontSize: 12, lineHeight: 1.45, color: '#6E7079' }}>Stop sharing turns the link off and keeps the file in your Drive. Delete from Drive removes the file too. The original recording stays in Klipkord either way.</span>
      </div>
    </>
  );
}
