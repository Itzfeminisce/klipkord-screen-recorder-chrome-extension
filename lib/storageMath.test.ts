import { describe, expect, it } from 'vitest';
import { DISK_LOW_BYTES, DISK_STOP_BYTES, freeBytes, isDiskLow, minutesLeft, shouldAutoStop } from './storageMath';

const GB = 1024 ** 3;

describe('storage threshold', () => {
  it('warns under 2 GB free', () => {
    expect(isDiskLow(2 * GB)).toBe(false);
    expect(isDiskLow(2 * GB - 1)).toBe(true);
    expect(isDiskLow(freeBytes({ usage: 9 * GB, quota: 10.2 * GB }))).toBe(true);
    expect(DISK_LOW_BYTES).toBe(2 * GB);
  });
  it('never reports negative free space', () => {
    expect(freeBytes({ usage: 5, quota: 3 })).toBe(0);
  });
  it('stops on its own before the disk is full', () => {
    expect(shouldAutoStop(DISK_STOP_BYTES)).toBe(false);
    expect(shouldAutoStop(DISK_STOP_BYTES - 1)).toBe(true);
  });
  it('estimates minutes left at the current rate', () => {
    expect(minutesLeft(1.2 * GB, 0)).toBeNull();
    // 1.2 GB with 300 MB held back, at about 1 MB/s → about 15 minutes.
    expect(minutesLeft(1.2 * GB, 1024 ** 2)).toBe(15);
    expect(minutesLeft(DISK_STOP_BYTES / 2, 1000)).toBe(0);
  });
});
