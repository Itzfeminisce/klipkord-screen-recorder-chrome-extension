/**
 * First-run setup: the machine check, which AI option it recommends, and how a pasted key is described.
 * Pure functions over values; `detectMachine` and the permission helpers are the only edges.
 * No key value is ever returned or logged here.
 */
import { availabilityOf } from './check/results';
import type { KeyStatus } from './connect';
import { detectKey, jobsFor, serviceLabel, type KeyName } from './keyDetect';
import type { AiMode, NotesEngine, Settings } from './types';

export const PENV_CLOUD_URL = 'https://penv.cloud';
export const GROQ_KEYS_URL = 'https://console.groq.com/keys';
export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';
export const REPO_URL = 'https://github.com/Itzfeminisce/klipkord-screen-recorder-chrome-extension';

// ---- Machine check ----

/** What this computer can run. `null` while a check has not finished. */
export interface MachineCheck { webgpu: boolean | null; builtinAi: boolean | null }

export type SetupState = 'no-built-in-ai' | 'slow-computer';

export interface SetupChoice {
  ai: AiMode;                // the option marked Recommended and selected by default
  notesEngine: NotesEngine;  // what writes notes under that option
  states: SetupState[];      // messages Setup shows
}

/** The notes engine for an AI option: Groq when cloud, else Chrome's built-in AI, else Ollama. */
export function notesEngineFor(ai: AiMode, builtinAi: boolean | null): NotesEngine {
  if (ai === 'cloud') return 'groq';
  return builtinAi === false ? 'ollama' : 'builtin';
}

/** Local needs WebGPU for usable speed; without it Groq is the default. Missing built-in AI only moves notes. */
export function setupChoice(check: MachineCheck): SetupChoice {
  const ai: AiMode = check.webgpu === false ? 'cloud' : 'local';
  const states: SetupState[] = [];
  if (check.builtinAi === false) states.push('no-built-in-ai');
  if (check.webgpu === false) states.push('slow-computer');
  return { ai, notesEngine: notesEngineFor(ai, check.builtinAi), states };
}

/** True when either built-in AI API can run or fetch its model. */
export function builtinAiPresent(summarizer: unknown, languageModel: unknown): boolean {
  const ok = (raw: unknown) => {
    const a = availabilityOf(raw);
    return a === 'available' || a === 'downloadable' || a === 'downloading';
  };
  return ok(summarizer) || ok(languageModel);
}

export interface MachineEnv {
  gpu?: { requestAdapter(): Promise<unknown> };
  summarizer?: { availability?: () => Promise<unknown> };
  languageModel?: { availability?: () => Promise<unknown> };
}

/** The real browser's environment (T0's machine check, no prompts). */
export function browserEnv(): MachineEnv {
  const g = globalThis as unknown as Record<string, MachineEnv['summarizer']>;
  return { gpu: (navigator as unknown as MachineEnv).gpu, summarizer: g.Summarizer, languageModel: g.LanguageModel };
}

/** Asks for a WebGPU adapter and the built-in AI availability. A failing probe counts as missing. */
export async function detectMachine(env: MachineEnv = browserEnv()): Promise<MachineCheck> {
  const probe = async (run?: () => Promise<unknown>): Promise<unknown> => {
    try { return await run?.(); } catch { return undefined; }
  };
  const [adapter, summarizer, languageModel] = await Promise.all([
    probe(env.gpu ? () => env.gpu!.requestAdapter() : undefined),
    probe(env.summarizer?.availability ? () => env.summarizer!.availability!() : undefined),
    probe(env.languageModel?.availability ? () => env.languageModel!.availability!() : undefined),
  ]);
  return { webgpu: !!adapter, builtinAi: builtinAiPresent(summarizer, languageModel) };
}

// ---- First run ----

/** First run: no key source, no recordings and the AI choice never confirmed. */
export function isFirstRun(settings: Pick<Settings, 'keySource' | 'onboarded'>, recordingCount: number): boolean {
  return !settings.onboarded && settings.keySource === null && recordingCount === 0;
}

// ---- Keys ----

export type RowStatus = KeyStatus | 'checking';

export const STATUS_WORD: Record<RowStatus, string> = {
  ok: 'Ready',
  checking: 'Checking…',
  rejected: 'Rejected',
  unreachable: 'Couldn’t check',
};

/** "transcripts and notes" / "notes": what a key covers, in words. */
export function jobsPhrase(name: KeyName): string {
  return jobsFor(name).join(' and ');
}

export type PasteClass =
  | { kind: 'empty' }
  | { kind: 'known'; name: KeyName; title: string; jobs: string }
  | { kind: 'unknown' };

/** What a pasted value is: a recognised key (with row wording), or one Klipkord can't place. */
export function classifyPaste(value: string): PasteClass {
  if (!value.trim()) return { kind: 'empty' };
  const name = detectKey(value);
  if (!name) return { kind: 'unknown' };
  return { kind: 'known', name, title: `This is a ${serviceLabel(name)} key`, jobs: `Covers ${jobsPhrase(name)}` };
}

/** Services offered as chips when a pasted key isn't recognised. */
export const SERVICE_CHOICES: KeyName[] = ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];

/** Where a user creates a new key for a service. */
export const KEY_PAGE: Record<KeyName, string> = {
  GROQ_API_KEY: GROQ_KEYS_URL,
  OPENROUTER_API_KEY: 'https://openrouter.ai/keys',
  OPENAI_API_KEY: 'https://platform.openai.com/api-keys',
  ANTHROPIC_API_KEY: 'https://console.anthropic.com/settings/keys',
};

/** Key names the chosen setup needs. Groq does both jobs. */
export const NEEDED_KEYS: string[] = ['GROQ_API_KEY'];

/** The needed keys that are not loaded yet. */
export function missingKeys(needed: string[], loaded: string[]): string[] {
  return needed.filter((n) => !loaded.includes(n));
}

type StatusMap = Record<string, RowStatus | undefined>;

/** "Start recording" is allowed once a usable key is loaded and works (or could not be checked); none is still being checked. */
export function canStart(loaded: string[], status: StatusMap): boolean {
  const usable = loaded.filter((n) => n in KEY_PAGE);
  return usable.some((n) => status[n] === 'ok' || status[n] === 'unreachable');
}

/** The AI settings "Start recording" saves once keys work: cloud only when a Groq key can transcribe. */
export function cloudSettings(loaded: string[], status: StatusMap): Pick<Settings, 'ai' | 'notesEngine'> | null {
  const groq = status.GROQ_API_KEY === 'ok' || status.GROQ_API_KEY === 'unreachable';
  return loaded.includes('GROQ_API_KEY') && groq ? { ai: 'cloud', notesEngine: 'groq' } : null;
}

// ---- Settings rows ----

/** The Transcripts row: the engine and, for Whisper, whether the model is on this computer. */
export function transcriptsStatus(ai: AiMode, modelDownloaded?: boolean): string {
  if (ai === 'cloud') return 'Groq';
  return modelDownloaded ? 'Whisper · downloaded' : 'Whisper';
}

/** "Connected · 1 key" for the Penv Cloud row; null when not connected. */
export function penvRowStatus(connected: boolean, keyCount: number): string | null {
  if (!connected) return null;
  return `Connected · ${keyCount} ${keyCount === 1 ? 'key' : 'keys'}`;
}

/** Notes engines Settings offers: Groq only while cloud AI is on. */
export function notesOptions(ai: AiMode): { value: NotesEngine; label: string }[] {
  const options: { value: NotesEngine; label: string }[] = [
    { value: 'builtin', label: 'Chrome’s built-in AI' },
    { value: 'ollama', label: 'Ollama on this computer' },
  ];
  if (ai === 'cloud') options.push({ value: 'groq', label: 'Groq' });
  return options;
}

// ---- Permissions (helper tab) ----

const PERMISSION_RESULT_KEY = 'permissionResult';

export interface PermissionResult { mic: boolean; camera: boolean }

/** Opens the extension tab that shows Chrome's prompt; the side panel can't. */
export function openPermissionTab(camera: boolean): Promise<unknown> {
  const url = (browser.runtime.getURL as (p: string) => string)('/permission.html');
  return browser.tabs.create({ url: `${url}?camera=${camera ? 1 : 0}` });
}

/** Called by the helper tab once Chrome has answered. */
export function reportPermission(result: PermissionResult): Promise<void> {
  return browser.storage.session.set({ [PERMISSION_RESULT_KEY]: { ...result, at: Date.now() } });
}

/** Calls `cb` when the helper tab reports. Returns an unsubscribe function. */
export function onPermissionResult(cb: (result: PermissionResult) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const v = changes[PERMISSION_RESULT_KEY]?.newValue as (PermissionResult & { at: number }) | undefined;
    if (area === 'session' && v) cb({ mic: v.mic, camera: v.camera });
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/**
 * Asks for the microphone, and the camera too when wanted. A refused camera falls back to the mic alone, so a
 * camera problem never blocks recording. Run from an extension tab, not the side panel.
 */
export async function requestAccess(wantCamera: boolean, media: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices): Promise<PermissionResult> {
  const grab = async (constraints: MediaStreamConstraints): Promise<boolean> => {
    try {
      (await media.getUserMedia(constraints)).getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  };
  if (wantCamera && (await grab({ audio: true, video: true }))) return { mic: true, camera: true };
  return { mic: await grab({ audio: true }), camera: false };
}
