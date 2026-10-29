import { describe, expect, it } from 'vitest';
import { availabilityOf, emptyResults, errorText, failingTests, numberLines, resultsJson, withResult } from './results';

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

  it('keeps earlier finished runs when a test runs again', () => {
    let r = emptyResults({}, now);
    r = withResult(r, 'sound', { status: 'running', numbers: {} }, now);
    r = withResult(r, 'sound', { status: 'warn', numbers: { peak: -99 } }, now);
    r = withResult(r, 'sound', { status: 'running', numbers: {} }, now);
    expect(r.tests.sound.earlier).toEqual([{ status: 'warn', numbers: { peak: -99 } }]);
    r = withResult(r, 'sound', { status: 'pass', numbers: { peak: -20 } }, now);
    expect(r.tests.sound.earlier).toEqual([{ status: 'warn', numbers: { peak: -99 } }]);
    r = withResult(r, 'sound', { status: 'pass', numbers: { peak: -18 } }, now);
    expect(r.tests.sound.earlier?.map((e) => e.numbers.peak)).toEqual([-99, -20]);
    expect(r.tests.sound.earlier?.every((e) => e.earlier === undefined)).toBe(true);
  });

  it('lists failing and warning tests in order', () => {
    let r = emptyResults({}, now);
    r = withResult(r, 'whisper', { status: 'fail', numbers: {} }, now);
    r = withResult(r, 'sound', { status: 'warn', numbers: {} }, now);
    r = withResult(r, 'mp4', { status: 'pass', numbers: {} }, now);
    expect(failingTests(r)).toEqual(['sound', 'whisper']);
  });
});
