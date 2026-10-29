import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getFolderHandle, getRecording, putFolderHandle, updateRecording } from '@/lib/db';
import { buildCaptions } from '@/lib/captions';
import { editedLength } from '@/lib/editList';
import { encodeKept, needsEncode } from '@/lib/encode';
import { ensureAccess, fileNames, pickFolder, saveFiles, videoExt, type Choice, type Planned } from '@/lib/folder';
import { estimateVideoBytes } from '@/lib/library';
import { buildMarkdown } from '@/lib/markdown';
import { updateSettings } from '@/lib/settings';
import { formatBytes, formatClock } from '@/lib/time';
import type { Recording } from '@/lib/types';
import { videoStore } from '@/lib/videoStore';
import { Spinner } from '../components';
import { useRouter } from '../router';
import { BannerAction, StateBanner } from './Setup';

const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const CARD: CSSProperties = { borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB' };
const SUB: CSSProperties = { fontSize: 12, color: '#6E7079' };
const OUTLINE: CSSProperties = { height: 44, border: '1px solid #E8E8EB', borderRadius: 12, background: '#FFFFFF', font: 'inherit', fontSize: 13, fontWeight: 500, color: '#111114', cursor: 'pointer' };

export function BackBar({ label, onBack, title, size = 20, right }: { label: string; onBack: () => void; title?: string; size?: number; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 16px 0' }}>
      <button type="button" aria-label={label} onClick={onBack} style={{ width: 44, height: 44, borderRadius: 12, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111114', cursor: 'pointer' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth="2" {...stroke} aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      {title && <h1 style={{ flexGrow: 1, margin: 0, fontSize: size, fontWeight: 600, letterSpacing: size > 16 ? '-0.02em' : undefined }}>{title}</h1>}
      {right}
    </div>
  );
}

function Segmented({ label, value, options, onChange, disabled = [] }: { label: string; value: string; options: string[]; onChange: (v: string) => void; disabled?: string[] }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: '#EBEBEE' }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button key={o} type="button" role="radio" aria-checked={on} disabled={disabled.includes(o)} onClick={() => onChange(o)}
            style={{ height: 28, padding: '0 10px', border: 'none', borderRadius: 6, background: on ? '#FFFFFF' : 'transparent', boxShadow: on ? '0 1px 2px rgba(16,16,20,0.08)' : undefined, font: 'inherit', fontSize: 12, fontWeight: on ? 600 : 400, color: on ? '#111114' : '#5F6168', opacity: disabled.includes(o) ? 0.4 : 1, cursor: disabled.includes(o) ? 'default' : 'pointer' }}>{o}</button>
        );
      })}
    </div>
  );
}

function Row({ name, sub, checked, onCheck, children }: { name: string; sub: string; checked: boolean; onCheck: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={name} style={{ width: 18, height: 18, accentColor: '#C2410C', margin: 0 }} />
      <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span><span style={SUB}>{sub}</span></span>
      {children}
    </div>
  );
}

const DIVIDER = <div style={{ height: 1, background: '#EFEFF1', margin: '0 14px' }} />;
const FOLDER_ICON = <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth="2" {...stroke} aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
const WARN_ICON = <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth="2" {...stroke} aria-hidden="true"><path d="M12 3l10 18H2zM12 10v5M12 18h0" /></svg>;

const isDenied = (e: unknown) => ['NotAllowedError', 'SecurityError'].includes((e as { name?: string } | null)?.name ?? '');

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Print-to-PDF from its own tab: the side panel cannot show Chrome's print dialog. */
function printPdf(recordingId: string) {
  void browser.tabs.create({ url: browser.runtime.getURL(`/print.html?recordingId=${encodeURIComponent(recordingId)}`) });
}

export default function Export() {
  const { route, back, navigate } = useRouter();
  const id = route.params.recordingId;
  const [rec, setRec] = useState<Recording | null | undefined>();
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | undefined>();
  const [choice, setChoice] = useState<Choice>({ video: true, notes: true, captions: true, captionFormat: 'srt' });
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(0);
  const [problem, setProblem] = useState<'access' | 'failed' | null>(null);
  const [copied, setCopied] = useState(false);
  const stop = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!id) return setRec(null);
    getRecording(id).then((r) => setRec(r ?? null), (error) => { console.error('Klipkord: could not load the recording', error); setRec(null); });
    getFolderHandle().then(setHandle, (error) => console.error('Klipkord: could not read the save folder', error));
    return () => stop.current?.abort();
  }, [id]);

  if (rec === undefined) return <main className="screen screen-center"><Spinner /></main>;
  if (!rec) return <main className="screen screen-center"><BackBar label="Back" onBack={back} /></main>;
  const r = rec;

  const own = videoExt(r.mime);
  const ext = choice.videoFormat ?? own;
  const length = r.duration > 0 ? editedLength(r.edits, r.duration) : 0;
  const cut = r.edits.length > 0;
  const encode = needsEncode(cut, own, ext);
  const hasCaptions = r.transcript.length > 0;
  const names = fileNames(r, { ...choice, captions: choice.captions && hasCaptions });
  const nothing = names.length === 0;
  const set = (p: Partial<Choice>) => setChoice((c) => ({ ...c, ...p }));

  async function chooseFolder(): Promise<FileSystemDirectoryHandle | undefined> {
    try {
      const picked = await pickFolder();
      if (!picked) return undefined;
      await putFolderHandle(picked);
      await updateSettings({ folderName: picked.name });
      setHandle(picked);
      setProblem(null);
      return picked;
    } catch (error) {
      console.error('Klipkord: could not change the save folder', error);
      return undefined;
    }
  }

  async function allow() {
    if (!handle) return void chooseFolder();
    try { if (await ensureAccess(handle, true)) setProblem(null); } catch (error) { console.error('Klipkord: could not ask for the folder', error); }
  }

  async function save() {
    // Folder pick and permission both need this click, so they run before any slow work.
    const dir = handle ?? (await chooseFolder());
    if (!dir) return;
    try {
      if (!(await ensureAccess(dir, true))) return setProblem('access');
    } catch { return setProblem('access'); }
    setProblem(null);
    setBusy(true);
    setShare(0);
    const abort = new AbortController();
    stop.current = abort;
    try {
      const plan: Planned[] = [];
      if (choice.video) {
        plan.push({
          name: `video.${ext}`,
          data: async () => {
            const blob = encode ? await encodeKept(r, setShare, abort.signal, ext) : await videoStore.read(r.id, 'video', r.mime);
            if (blob.size === 0) throw new Error('The recording has no video');
            return blob;
          },
        });
      }
      if (choice.notes) plan.push({ name: 'notes.md', data: async () => buildMarkdown(r) });
      if (choice.captions && hasCaptions) plan.push({ name: `captions.${choice.captionFormat}`, data: async () => buildCaptions(r.transcript, r.edits, r.duration, choice.captionFormat) });
      const { dir: sub, saved } = await saveFiles(dir, r.title, plan);
      await updateRecording(r.id, { savedTo: { folder: dir.name, at: Date.now(), files: saved.map((f) => `${sub}/${f.name}`) } });
      navigate('Saved', { recordingId: r.id });
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return;
      console.error('Klipkord: could not save to the folder', error);
      setProblem(isDenied(error) ? 'access' : 'failed');
    } finally {
      setBusy(false);
    }
  }

  const markdown = () => buildMarkdown(r);
  const copy = () => navigator.clipboard.writeText(markdown()).then(
    () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
    (error) => console.error('Klipkord: could not copy the notes', error),
  );

  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      <BackBar label="Back" onBack={back} title="Save to your computer" size={16} />

      {problem === 'access' && (
        <div style={{ margin: '12px 16px 0' }}>
          <StateBanner mark={FOLDER_ICON} tone="info" title="Klipkord needs your OK to use the folder again" body="Chrome asks again after it restarts. Your recording is safe in Klipkord."
            action={<BannerAction onClick={() => void allow()}>Allow folder</BannerAction>} />
        </div>
      )}
      {problem === 'failed' && (
        <div style={{ margin: '12px 16px 0' }}>
          <StateBanner mark={WARN_ICON} tone="error" title="The video couldn’t be saved" body="There isn’t enough space in that folder. The recording is still safe in Klipkord."
            action={<BannerAction onClick={() => void chooseFolder()}>Choose another folder</BannerAction>} />
        </div>
      )}

      <div style={{ ...CARD, margin: '12px 16px 0', padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: 12, background: '#FFF1EA', color: '#9A3412', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{FOLDER_ICON}</span>
        <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={SUB}>Folder</span>
          <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{handle?.name ?? ''}</span>
        </span>
        <button type="button" onClick={() => void chooseFolder()} disabled={busy} style={{ ...OUTLINE, height: 36, padding: '0 12px', borderRadius: 10 }}>Change</button>
      </div>

      <div style={{ ...CARD, margin: '10px 16px 0', display: 'flex', flexDirection: 'column' }}>
        <Row name="Video" checked={choice.video} onCheck={(v) => set({ video: v })}
          sub={`${cut ? `${formatClock(length)} with your cuts` : formatClock(length)} · about ${formatBytes(estimateVideoBytes(r))}`}>
          <Segmented label="Video format" value={ext === 'webm' ? 'WebM' : 'MP4'} options={['MP4', 'WebM']} onChange={(v) => set({ videoFormat: v === 'WebM' ? 'webm' : 'mp4' })} />
        </Row>
        {DIVIDER}
        <Row name="Notes" sub="Summary, steps, chapters and transcript in Markdown" checked={choice.notes} onCheck={(v) => set({ notes: v })} />
        {DIVIDER}
        <Row name="Captions" sub="For any video player" checked={choice.captions && hasCaptions} onCheck={(v) => set({ captions: v })}>
          <Segmented label="Captions format" value={choice.captionFormat.toUpperCase()} options={['SRT', 'VTT']} onChange={(v) => set({ captionFormat: v === 'VTT' ? 'vtt' : 'srt' })} />
        </Row>
      </div>

      <div style={{ margin: '10px 16px 0', padding: '12px 14px', borderRadius: 12, background: '#EBEBEE', fontFamily: "var(--mono, 'Geist Mono', monospace)", fontSize: 12, lineHeight: 1.7, color: '#44464D', wordBreak: 'break-word' }}>
        {r.title}/{names.map((n) => <div key={n} style={{ paddingLeft: 12 }}>{n}</div>)}
      </div>

      <div style={{ padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={() => void save()} disabled={busy || nothing}
          style={{ height: 48, border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: nothing ? 0.5 : 1, cursor: busy ? 'default' : 'pointer' }}>
          {busy ? <Spinner /> : 'Save to folder'}
        </button>
        {busy && choice.video && encode && (
          <span role="progressbar" aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 999, background: '#F1F1F3', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${Math.round(share * 100)}%`, height: '100%', background: '#C2410C' }} />
          </span>
        )}
      </div>

      <div style={{ margin: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#5F6168' }}>Share</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <button type="button" onClick={() => navigate('GifClip', { recordingId: r.id })} style={{ ...OUTLINE, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth="2" {...stroke} aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9.5v5l4-2.5z" /></svg>Make a GIF
          </button>
          {/* DriveLink is T11; this has no target until then. */}
          <button type="button" style={{ ...OUTLINE, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth="2" {...stroke} aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>Share a link
          </button>
        </div>
      </div>

      <div style={{ flexGrow: 1 }} />
      <div style={{ margin: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#5F6168' }}>Just the notes</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          <button type="button" onClick={() => void copy()} style={OUTLINE}>
            {copied ? <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth="2.4" {...stroke} aria-label="Copy"><path d="M5 12l5 5 9-10" /></svg> : 'Copy'}
          </button>
          <button type="button" onClick={() => download('notes.md', new Blob([markdown()], { type: 'text/markdown' }))} style={OUTLINE}>Markdown</button>
          <button type="button" onClick={() => printPdf(r.id)} style={OUTLINE}>PDF</button>
        </div>
        <span style={SUB}>The original recording stays in Klipkord.</span>
      </div>
    </main>
  );
}
