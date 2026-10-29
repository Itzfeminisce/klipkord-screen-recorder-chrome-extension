export type CaptureMode = 'tab' | 'window' | 'screen';
export type Quality = '720p' | '1080p';
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type BubbleSize = 'S' | 'M' | 'L';
export type NoteStyle = 'howto' | 'bug' | 'update' | 'meeting' | 'general';
export type MarkerKind = 'step' | 'bug' | 'important' | 'question';
export type AiMode = 'local' | 'cloud';                 // "On this computer" / "Faster with Groq"
export type NotesEngine = 'builtin' | 'ollama' | 'groq';
export type RecordingStatus = 'recording' | 'paused' | 'processing' | 'ready' | 'unfinished';

export interface Settings {
  ai: AiMode;                                          // default from the machine check
  notesEngine: NotesEngine;                            // default 'builtin', else 'ollama'
  language: string | 'auto';                           // default 'auto'
  keySource: 'penv-app' | 'paste' | null;
  penvApp?: { connectionId: string; org: string; project: string; env: string; keys: string[] }; // grant in session storage
  capture: { mode: CaptureMode; mic: boolean; camera: boolean; sound: boolean; quality: Quality };
  bubble: { corner: Corner; size: BubbleSize };        // default bottom-left, M
  defaultStyle?: NoteStyle;                            // "Always use this style": skips detection
  folderName?: string;                                 // handle itself kept in IndexedDB
  onboarded?: boolean;                                 // set once the first-run AI choice is made (T2)
}

export interface Marker { id: string; at: number; kind: MarkerKind }            // at = ms into the recording
export interface TimedNote { id: string; at: number; text: string }
export interface Comment { id: string; at: number; text: string; resolved: boolean; createdAt: number }
export interface Segment { start: number; end: number; text: string }           // ms
export interface Chapter { at: number; title: string }
export interface KeptRange { start: number; end: number }                      // edit list, ms

export interface Notes {
  style: NoteStyle; detected: NoteStyle; engine: string;  // engine names the AI in the Review footer
  summary: string; points: string[]; actions: string[]; chapters: Chapter[];
  sections?: Record<string, string[]>;                 // style-specific, e.g. bug: steps, expected, happened
}

export interface Recording {
  id: string; title: string; createdAt: number; duration: number;  // ms, after pauses
  status: RecordingStatus; mode: CaptureMode; quality: Quality;
  height?: number;                                     // px actually captured; older records only have quality
  mime: string;                                        // 'video/mp4' or 'video/webm'
  bytes: number; thumbnail?: Blob;
  markers: Marker[]; notes: TimedNote[]; comments: Comment[];
  transcript: Segment[]; transcriptPending: boolean;   // chunks still queued
  summary?: Notes; edits: KeptRange[];                 // empty = whole video
  savedTo?: { folder: string; at: number; files: string[] };
}
