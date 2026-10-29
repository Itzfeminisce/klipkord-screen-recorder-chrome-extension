import { describe, expect, it } from 'vitest';
import { noSpeech } from './NotesBody';
import { transcriptTitle } from '../screens/Processing';
import type { Recording } from '@/lib/types';

const rec = (over: Partial<Recording>) => ({ transcript: [], transcriptPending: false, ...over }) as Recording;

describe('transcript row', () => {
  it('says writing until the transcript is done', () => {
    expect(transcriptTitle(true)).toBe('Writing the transcript');
    expect(transcriptTitle(false)).toBe('Transcript ready');
  });
});

describe('noSpeech', () => {
  it('is true only for a finished, empty transcript', () => {
    expect(noSpeech(rec({}))).toBe(true);
    expect(noSpeech(rec({ transcriptPending: true }))).toBe(false);
    expect(noSpeech(rec({ transcript: [{ start: 0, end: 1, text: 'hi' }] }))).toBe(false);
    expect(noSpeech(null)).toBe(false);
  });
});
