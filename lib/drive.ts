/** Google Drive links: resumable upload of one video, then an "anyone with the link" reader permission. */

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
// Drive wants chunks in multiples of 256 KiB; 8 MiB keeps the progress bar moving.
export const CHUNK_BYTES = 32 * 256 * 1024;
const RETRIES = 3;

export type Fetch = typeof fetch;
export interface DriveFile { id: string; webViewLink: string }
export interface Share { fileId: string; link: string; name: string; size: number; permissionId?: string }
export type DriveState = 'drive-connect' | 'drive-offline' | 'drive-upload-failed';

export class DriveError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'DriveError'; }
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function check(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new DriveError(res.status, `${what} failed with ${res.status}`);
  return res;
}

export function contentRange(start: number, end: number, total: number): string {
  return `bytes ${start}-${end - 1}/${total}`;
}

/** Bytes Google already has, from a 308's `Range: bytes=0-N`; 0 when it has none. */
export function receivedBytes(range: string | null): number {
  const m = range?.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}

export function parseFile(body: unknown): DriveFile {
  const b = body as Partial<DriveFile> | null;
  if (!b?.id || !b.webViewLink) throw new Error('Drive returned no file link');
  return { id: b.id, webViewLink: b.webViewLink };
}

/** Opens an upload session; Drive answers with the session URL in Location. */
export async function startUpload(fetchFn: Fetch, token: string, meta: { name: string; mimeType: string; size: number }): Promise<string> {
  const res = await check(await fetchFn(`${UPLOAD}?uploadType=resumable&fields=id,webViewLink`, {
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': meta.mimeType, 'X-Upload-Content-Length': String(meta.size) },
    body: JSON.stringify({ name: meta.name, mimeType: meta.mimeType }),
  }), 'Starting the upload');
  const session = res.headers.get('Location');
  if (!session) throw new Error('Drive returned no upload session');
  return session;
}

type Step = { done: DriveFile } | { offset: number };

async function step(res: Response, what: string): Promise<Step> {
  if (res.status === 308) return { offset: receivedBytes(res.headers.get('Range')) };
  await check(res, what);
  return { done: parseFile(await res.json()) };
}

/** Asks the session how far it got, for a resume. */
export async function uploadStatus(fetchFn: Fetch, token: string, session: string, size: number): Promise<Step> {
  return step(await fetchFn(session, { method: 'PUT', headers: { ...auth(token), 'Content-Range': `bytes */${size}` } }), 'Checking the upload');
}

const retryable = (e: unknown) => e instanceof TypeError || (e instanceof DriveError && e.status >= 500);

export interface UploadDeps { fetch: Fetch; sleep?: (ms: number) => Promise<void> }

/** Sends the blob in chunks; a dropped chunk, or `resume`, continues from Google's own count. */
export async function uploadChunks(deps: UploadDeps, token: string, session: string, blob: Blob, onProgress: (sent: number) => void, signal?: AbortSignal, resume = false): Promise<DriveFile> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const size = blob.size;
  let offset = 0;
  if (resume) {
    const now = await uploadStatus(deps.fetch, token, session, size);
    if ('done' in now) { onProgress(size); return now.done; }
    offset = now.offset;
  }
  let failures = 0;
  for (;;) {
    signal?.throwIfAborted();
    try {
      const end = Math.min(size, offset + CHUNK_BYTES);
      const res = await deps.fetch(session, { method: 'PUT', headers: { ...auth(token), 'Content-Range': contentRange(offset, end, size) }, body: blob.slice(offset, end), signal });
      const next = await step(res, 'Uploading');
      if ('done' in next) { onProgress(size); return next.done; }
      offset = next.offset;
      failures = 0;
      onProgress(offset);
    } catch (error) {
      if (signal?.aborted || !retryable(error) || ++failures > RETRIES) throw error;
      await sleep(1000 * 2 ** (failures - 1));
      const now = await uploadStatus(deps.fetch, token, session, size);
      if ('done' in now) { onProgress(size); return now.done; }
      offset = now.offset;
      onProgress(offset);
    }
  }
}

/** Turns on "anyone with the link can view"; returns the permission id that Stop sharing removes. */
export async function shareAnyone(fetchFn: Fetch, token: string, fileId: string): Promise<string> {
  const res = await check(await fetchFn(`${API}/files/${encodeURIComponent(fileId)}/permissions?fields=id`, {
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone', allowFileDiscovery: false }),
  }), 'Sharing');
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new Error('Drive returned no permission');
  return body.id;
}

export async function stopSharing(fetchFn: Fetch, token: string, fileId: string, permissionId: string): Promise<void> {
  const res = await fetchFn(`${API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`, { method: 'DELETE', headers: auth(token) });
  if (res.status !== 404) await check(res, 'Stopping sharing');
}

export async function deleteFile(fetchFn: Fetch, token: string, fileId: string): Promise<void> {
  const res = await fetchFn(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: auth(token) });
  if (res.status !== 404) await check(res, 'Deleting');
}

/** Best effort: tells Drive to drop an unfinished upload session. */
export async function cancelUpload(fetchFn: Fetch, session: string): Promise<void> {
  await fetchFn(session, { method: 'DELETE' }).catch(() => undefined);
}

/** Which DriveLink state an error lands on. */
export function driveState(error: unknown, online: boolean): DriveState {
  if (!online || error instanceof TypeError) return 'drive-offline';
  if (error instanceof DriveError && error.status === 401) return 'drive-connect';
  return 'drive-upload-failed';
}

const shareKey = (recordingId: string) => `driveShare:${recordingId}`;

export async function getShare(recordingId: string): Promise<Share | undefined> {
  return (await browser.storage.local.get(shareKey(recordingId)))[shareKey(recordingId)] as Share | undefined;
}

export const putShare = (recordingId: string, share: Share): Promise<void> => browser.storage.local.set({ [shareKey(recordingId)]: share });
export const removeShare = (recordingId: string): Promise<void> => browser.storage.local.remove(shareKey(recordingId));
