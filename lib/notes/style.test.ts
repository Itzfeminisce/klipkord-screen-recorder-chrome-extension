import { describe, expect, it } from 'vitest';
import { buildDetectPrompt, guessStyle, parseDetect, STYLE_SECTIONS } from './style';
import type { Marker, NoteStyle } from '../types';

const m = (kind: Marker['kind'], at = 0): Marker => ({ id: kind + at, at, kind });

describe('parseDetect', () => {
  it('reads a style and a cleaned title', () => {
    expect(parseDetect({ style: ' BUG ', title: '"Checkout freezes."' })).toEqual({ style: 'bug', title: 'Checkout freezes' });
    expect(parseDetect({ style: 'howto' })).toEqual({ style: 'howto' });
  });
  it('rejects anything else', () => {
    expect(parseDetect({ style: 'poem' })).toBeNull();
    expect(parseDetect(null)).toBeNull();
  });
});

describe('guessStyle', () => {
  it('uses the markers when the call fails', () => {
    expect(guessStyle([m('step'), m('bug')])).toBe('bug');
    expect(guessStyle([m('step'), m('step', 5)])).toBe('howto');
    expect(guessStyle([m('question')])).toBe('general');
  });
});

describe('buildDetectPrompt', () => {
  it('stays short for a long transcript and lists the markers', () => {
    const segs = Array.from({ length: 2000 }, (_, i) => ({ start: i * 1000, end: i * 1000 + 900, text: 'word word word word' }));
    const { user } = buildDetectPrompt(segs, [m('bug', 228_000)]);
    expect(user.length).toBeLessThan(4300);
    expect(user).toContain('[03:48] bug');
  });
});

describe('section headings (NoteSections frame)', () => {
  const headings = (s: NoteStyle) => STYLE_SECTIONS[s].map((d) => d.heading);
  it('names each style’s sections', () => {
    expect(headings('howto')).toEqual(['Steps']);
    expect(headings('update')).toEqual(['What changed', 'What’s next', 'Blocked']);
    expect(headings('meeting')).toEqual(['Decisions']);
    expect(headings('general')).toEqual([]);
    expect(headings('bug')).toEqual(['Steps to reproduce', 'Expected', 'What happened']);
  });
});
