import type { CaptureMode, MarkerKind, Quality, Settings } from './types';
import type { RecorderState } from './recorder';

/** Runtime messages. Keyboard commands arrive as these; T3 and T5 act on them. */
export type Message =
  | { type: 'recording/toggle' }
  | { type: 'recording/pause' }
  | { type: 'marker/add'; kind: MarkerKind }
  // Side panel and background → offscreen recorder (T3).
  | { type: 'recorder/prepare'; streamId: string; mode: CaptureMode; mic: boolean; sound: boolean; quality: Quality; maxWidth: number; maxHeight: number; camera: boolean; bubble: Settings['bubble'] }
  | { type: 'recorder/bubble'; bubble: Settings['bubble'] }   // corner or size changed (T4)
  | { type: 'recorder/begin' }
  | { type: 'recorder/pause' }
  | { type: 'recorder/resume' }
  | { type: 'recorder/stop' }
  | { type: 'recorder/cancel' }
  | { type: 'recorder/restart' }
  | { type: 'recorder/discard' }
  | { type: 'recorder/mute'; muted: boolean }
  // Offscreen recorder → background (badge, session state).
  | { type: 'recorder/state'; state: RecorderState }
  | { type: 'recorder/tick'; elapsed: number };

export type MessageType = Message['type'];
export type MessageOf<T extends MessageType> = Extract<Message, { type: T }>;

/** Manifest command names (wxt.config.ts) → the message each one sends. */
export const COMMANDS = {
  'toggle-recording': { type: 'recording/toggle' },
  'toggle-pause': { type: 'recording/pause' },
  'add-marker': { type: 'marker/add', kind: 'step' },
} as const satisfies Record<string, Message>;

export function commandMessage(command: string): Message | undefined {
  return (COMMANDS as Record<string, Message>)[command];
}

/**
 * Sends a runtime message. Resolves with the listener's response, or undefined when nothing is listening
 * (never throws for "Receiving end does not exist").
 */
export async function send<R = unknown>(msg: Message): Promise<R | undefined> {
  try {
    return (await browser.runtime.sendMessage(msg)) as R | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Listens for runtime messages. Return a value (or a promise) from the handler to reply; return undefined to ignore.
 * Returns an unsubscribe function.
 */
export function onMessage(
  handler: (msg: Message, sender: Browser.runtime.MessageSender) => unknown,
): () => void {
  // sendResponse + `return true` works on every Chrome version, unlike returning a promise.
  const listener = (msg: unknown, sender: Browser.runtime.MessageSender, sendResponse: (r?: unknown) => void) => {
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return false;
    const result = handler(msg as Message, sender);
    if (result === undefined) return false;
    Promise.resolve(result).then(sendResponse, () => sendResponse(undefined));
    return true;
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
