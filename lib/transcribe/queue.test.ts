import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@/lib/types';
import { createQueue, type QueueDeps, type QueueStatus } from './queue';
import { GroqError } from './groq';

const speech = () => new Float32Array(1600).fill(0.2);
const chunk = (i: number) => ({ start: i * 10_000, end: (i + 1) * 10_000, audio: speech() });
const tick = () => new Promise((r) => setTimeout(r, 0));

function deps(over: Partial<QueueDeps> = {}) {
  const segments: Segment[] = [];
  const statuses: QueueStatus[] = [];
  const d: QueueDeps = {
    local: async () => 'local text',
    groq: async () => 'groq text',
    online: () => true,
    onSegment: (s) => segments.push(s),
    onStatus: (s) => statuses.push(s),
    ...over,
  };
  return { d, segments, statuses };
}

describe('transcript queue', () => {
  it('catches up in recording order after a slow start, and reports behind', async () => {
    const order: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    const { d, segments, statuses } = deps({
      local: async () => {
        const i = n++;
        if (i === 0) await gate;
        order.push(i);
        return `text ${i}`;
      },
    });
    const q = createQueue(d, 'local');
    for (let i = 0; i < 4; i++) q.add(chunk(i));
    await tick();
    expect(q.status.pending).toBe(4);
    expect(q.status.behind).toBe(true);
    release();
    await q.drain();
    expect(order).toEqual([0, 1, 2, 3]);
    expect(segments.map((s) => s.start)).toEqual([0, 10_000, 20_000, 30_000]);
    expect(statuses.at(-1)).toMatchObject({ pending: 0, behind: false });
  });

  it('skips silent chunks without running a model', async () => {
    const local = vi.fn(async () => 'x');
    const { d, segments } = deps({ local });
    const q = createQueue(d, 'local');
    q.add({ start: 0, end: 10_000, audio: new Float32Array(1600) });
    await q.drain();
    expect(local).not.toHaveBeenCalled();
    expect(segments).toEqual([]);
  });

  it('Groq down: this chunk and the rest run locally (cloud-ai-down)', async () => {
    const groq = vi.fn(async () => { throw new GroqError('down', 'server'); });
    const { d, segments } = deps({ groq });
    const q = createQueue(d, 'groq');
    q.add(chunk(0));
    q.add(chunk(1));
    await q.drain();
    expect(groq).toHaveBeenCalledTimes(1);
    expect(segments.map((s) => s.text)).toEqual(['local text', 'local text']);
    expect(q.status).toMatchObject({ cloudDown: true, engine: 'local' });
  });

  it('offline: local while the network is down, Groq again once online', async () => {
    let online = false;
    const { d, segments } = deps({ online: () => online });
    const q = createQueue(d, 'groq');
    q.add(chunk(0));
    await q.drain();
    expect(q.status).toMatchObject({ offline: true, engine: 'local', cloudDown: false });
    online = true;
    q.add(chunk(1));
    await q.drain();
    expect(segments.map((s) => s.text)).toEqual(['local text', 'groq text']);
    expect(q.status).toMatchObject({ offline: false, engine: 'groq' });
  });

  it('"Use Groq for this one" moves later chunks to Groq', async () => {
    const { d, segments } = deps();
    const q = createQueue(d, 'local');
    q.add(chunk(0));
    await q.drain();
    q.useGroq();
    q.add(chunk(1));
    await q.drain();
    expect(segments.map((s) => s.text)).toEqual(['local text', 'groq text']);
  });

  it('cancel drops waiting chunks and reports nothing more', async () => {
    const { d, segments } = deps({ local: async () => { await tick(); return 'x'; } });
    const q = createQueue(d, 'local');
    for (let i = 0; i < 3; i++) q.add(chunk(i));
    q.cancel();
    await q.drain();
    expect(segments).toEqual([]);
  });
});
