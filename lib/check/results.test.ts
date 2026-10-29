import { describe, expect, it } from 'vitest';
import { availabilityOf, emptyResults, errorText, numberLines, resultsJson, withResult } from './results';

const now = new Date('2026-10-29T10:00:00Z');

describe('results', () => {
  it('starts with every test not run', () => {
    const r = emptyResults({ cores: 8 }, now);
    expect(Object.values(r.tests).every((t) => t.status === 'not run')).toBe(true);
    expect(JSON.parse(resultsJson(r)).machine.cores).toBe(8);
  });

  it('replaces one test without touching others', () => {
    const r = emptyResults({}, now);
    const next = withResult(r, 'mp4', { status: 'pass', numbers: { bytes: 10 } }, now);
    expect(next.tests.mp4.numbers.bytes).toBe(10);
    expect(next.tests.sound.status).toBe('not run');
    expect(r.tests.mp4.status).toBe('not run');
  });

  it('formats lines and errors', () => {
    expect(numberLines({ status: 'fail', numbers: { audio: false, level: null }, error: 'x' })).toEqual([
      'audio: no',
      'level: none',
      'error: x',
    ]);
    expect(errorText(new TypeError('bad'))).toBe('TypeError: bad');
    expect(errorText('plain')).toBe('plain');
  });

  it('maps availability values', () => {
    expect(availabilityOf('downloadable')).toBe('downloadable');
    expect(availabilityOf(undefined)).toBe('missing');
    expect(availabilityOf('readily')).toBe('missing');
  });
});
