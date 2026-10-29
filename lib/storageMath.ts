import type { StorageUsage } from './videoStore';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** Warn below 2 GB free (FRAMES.md, Storage). */
export const DISK_LOW_BYTES = 2 * GB;
/** Stop and save on our own before the disk is actually full. */
export const DISK_STOP_BYTES = 300 * MB;

export const freeBytes = ({ usage, quota }: StorageUsage): number => Math.max(0, quota - usage);

export const isDiskLow = (free: number): boolean => free < DISK_LOW_BYTES;

export const shouldAutoStop = (free: number): boolean => free < DISK_STOP_BYTES;

/** Minutes of recording left before the auto-stop, at the current write rate; null before a rate is known. */
export function minutesLeft(free: number, bytesPerSecond: number): number | null {
  if (!(bytesPerSecond > 0)) return null;
  return Math.max(0, Math.round((free - DISK_STOP_BYTES) / bytesPerSecond / 60));
}
