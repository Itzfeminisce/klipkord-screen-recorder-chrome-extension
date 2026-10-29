const pad = (n: number) => String(n).padStart(2, '0');

/** Time into a recording: 228000 → "03:48", 3723000 → "1:02:03". */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) ms = 0;
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Human duration rounded to minutes: "42 min", "1 h 5 min", "2 h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) ms = 0;
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** File size: 0 → "0 B", 1536 → "1.5 KB", 248000000 → "236.5 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return i === 0 ? `${n} B` : `${n >= 100 ? Math.round(n) : Math.round(n * 10) / 10} ${units[i]}`;
}
