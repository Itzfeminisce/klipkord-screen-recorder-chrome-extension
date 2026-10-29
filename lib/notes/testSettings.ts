import { DEFAULT_SETTINGS } from '../settings';
import type { Settings } from '../types';

/** Settings for tests that choose Groq for notes. */
export const defaultSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ai: 'cloud', notesEngine: 'groq', keySource: 'paste' });
