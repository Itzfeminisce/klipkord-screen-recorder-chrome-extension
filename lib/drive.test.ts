import { describe, expect, it, vi } from 'vitest';
import { CHUNK_BYTES, DriveError, contentRange, deleteFile, driveState, parseFile, receivedBytes, shareAnyone, startUpload, stopSharing, uploadChunks, type Fetch } from './drive';

const TOKEN = 'fake-token-not-real';
const SESSION = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fake-session';
const FILE = { id: 'fake-file-id', webViewLink: 'https://drive.google.com/file/d/fake-file-id/view' };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const resumeIncomplete = (last?: number) => new Response(null, { status: 308, headers: last === undefined ? {} : { Range: `bytes=0-${last}` } });

/** A fake fetch that answers each call in turn and records what was asked. */
function scripted(answers: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = answers.shift();
    if (!next) throw new Error('unexpected call');
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fn as unknown as Fetch, calls };
}

const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

describe('upload requests', () => {
  it('builds content ranges and reads Google’s received count', () => {
    expect(contentRange(0, 10, 25)).toBe('bytes 0-9/25');
    expect(receivedBytes('bytes=0-1048575')).toBe(1048576);
    expect(receivedBytes(null)).toBe(0);
  });

  it('opens a session with the size and type, and returns its Location', async () => {
    const { fetch, calls } = scripted([new Response(null, { status: 200, headers: { Location: SESSION } })]);
    const session = await startUpload(fetch, TOKEN, { name: 'demo.mp4', mimeType: 'video/mp4', size: 123 });
    expect(session).toBe(SESSION);
    expect(calls[0]!.url).toContain('uploadType=resumable');
    expect(header(calls[0]!.init, 'Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(header(calls[0]!.init, 'X-Upload-Content-Length')).toBe('123');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ name: 'demo.mp4', mimeType: 'video/mp4' });
  });

  it('sends chunks until Drive returns the file', async () => {
    const blob = new Blob([new Uint8Array(CHUNK_BYTES + 10)]);
    const { fetch, calls } = scripted([resumeIncomplete(CHUNK_BYTES - 1), json(FILE)]);
    const seen: number[] = [];
    const file = await uploadChunks({ fetch }, TOKEN, SESSION, blob, (n) => seen.push(n));
    expect(file).toEqual(FILE);
    expect(calls.map((c) => header(c.init, 'Content-Range'))).toEqual([`bytes 0-${CHUNK_BYTES - 1}/${blob.size}`, `bytes ${CHUNK_BYTES}-${blob.size - 1}/${blob.size}`]);
    expect(seen).toEqual([CHUNK_BYTES, blob.size]);
  });

  it('resumes from Google’s count after a dropped chunk', async () => {
    const blob = new Blob([new Uint8Array(100)]);
    const { fetch, calls } = scripted([new TypeError('Failed to fetch'), resumeIncomplete(39), json(FILE)]);
    const file = await uploadChunks({ fetch, sleep: async () => undefined }, TOKEN, SESSION, blob, () => undefined);
    expect(file).toEqual(FILE);
    expect(header(calls[1]!.init, 'Content-Range')).toBe('bytes */100');
    expect(header(calls[2]!.init, 'Content-Range')).toBe('bytes 40-99/100');
  });

  it('resumes an earlier session when asked', async () => {
    const blob = new Blob([new Uint8Array(100)]);
    const { fetch, calls } = scripted([resumeIncomplete(49), json(FILE)]);
    await uploadChunks({ fetch }, TOKEN, SESSION, blob, () => undefined, undefined, true);
    expect(header(calls[0]!.init, 'Content-Range')).toBe('bytes */100');
    expect(header(calls[1]!.init, 'Content-Range')).toBe('bytes 50-99/100');
  });

  it('gives up on a 401 without retrying', async () => {
    const { fetch, calls } = scripted([new Response(null, { status: 401 })]);
    await expect(uploadChunks({ fetch }, TOKEN, SESSION, new Blob([new Uint8Array(5)]), () => undefined)).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);
  });

  it('needs an id and a link in the finished file', () => {
    expect(() => parseFile({ id: 'x' })).toThrow();
  });
});

describe('permissions', () => {
  it('shares with anyone as a reader and returns the permission id', async () => {
    const { fetch, calls } = scripted([json({ id: 'anyoneWithLink' })]);
    expect(await shareAnyone(fetch, TOKEN, FILE.id)).toBe('anyoneWithLink');
    expect(calls[0]!.url).toBe('https://www.googleapis.com/drive/v3/files/fake-file-id/permissions?fields=id');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ role: 'reader', type: 'anyone' });
  });

  it('stop sharing deletes that permission; delete removes the file', async () => {
    const { fetch, calls } = scripted([new Response(null, { status: 204 }), new Response(null, { status: 204 })]);
    await stopSharing(fetch, TOKEN, FILE.id, 'anyoneWithLink');
    await deleteFile(fetch, TOKEN, FILE.id);
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['DELETE', 'https://www.googleapis.com/drive/v3/files/fake-file-id/permissions/anyoneWithLink'],
      ['DELETE', 'https://www.googleapis.com/drive/v3/files/fake-file-id'],
    ]);
  });

  it('treats an already-gone file as done', async () => {
    const { fetch } = scripted([new Response(null, { status: 404 })]);
    await expect(deleteFile(fetch, TOKEN, FILE.id)).resolves.toBeUndefined();
  });
});

describe('error states', () => {
  it('maps errors to the DriveLink states', () => {
    expect(driveState(new DriveError(500, 'x'), false)).toBe('drive-offline');
    expect(driveState(new TypeError('Failed to fetch'), true)).toBe('drive-offline');
    expect(driveState(new DriveError(401, 'x'), true)).toBe('drive-connect');
    expect(driveState(new DriveError(403, 'x'), true)).toBe('drive-upload-failed');
    expect(driveState(new Error('x'), true)).toBe('drive-upload-failed');
  });
});
