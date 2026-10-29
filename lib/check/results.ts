export type TestId = 'mp4' | 'sound' | 'composite' | 'whisper' | 'builtinAi';
export type Status = 'not run' | 'running' | 'pass' | 'warn' | 'fail';
export type Value = string | number | boolean | null;

export interface TestResult {
  status: Status;
  numbers: Record<string, Value>;
  error?: string;
  ranAt?: string;
  // Earlier finished runs of this test, oldest first.
  earlier?: TestResult[];
}

export interface Results {
  build: string;
  app: 'klipkord';
  check: 'T0';
  ranAt: string;
  machine: Record<string, Value>;
  tests: Record<TestId, TestResult>;
}

export const TESTS: { id: TestId; name: string }[] = [
  { id: 'mp4', name: '1. MP4 recording' },
  { id: 'sound', name: '2. Computer sound' },
  { id: 'composite', name: '3. 1080p30 + camera bubble' },
  { id: 'whisper', name: '4. Live Whisper' },
  { id: 'builtinAi', name: '5. Built-in AI' },
];

export function emptyResults(machine: Record<string, Value>, now: Date, build = 'dev'): Results {
  const tests = {} as Record<TestId, TestResult>;
  for (const t of TESTS) tests[t.id] = { status: 'not run', numbers: {} };
  return { build, app: 'klipkord', check: 'T0', ranAt: now.toISOString(), machine, tests };
}

const finished = (s: Status) => s === 'pass' || s === 'warn' || s === 'fail';

// A new run keeps every earlier finished run of the same test.
export function withResult(results: Results, id: TestId, result: TestResult, now: Date): Results {
  const prev = results.tests[id];
  let earlier = prev.earlier ?? [];
  if (finished(prev.status)) {
    const { earlier: _, ...last } = prev;
    earlier = [...earlier, last];
  }
  const next: TestResult = { ...result };
  delete next.earlier;
  if (earlier.length) next.earlier = earlier;
  return { ...results, ranAt: now.toISOString(), tests: { ...results.tests, [id]: next } };
}

export function failingTests(results: Results): TestId[] {
  return TESTS.map((t) => t.id).filter((id) => ['fail', 'warn'].includes(results.tests[id].status));
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function formatValue(value: Value): string {
  if (value === null) return 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

// One line per number for the readable table.
export function numberLines(result: TestResult): string[] {
  const lines = Object.entries(result.numbers).map(([k, v]) => `${k}: ${formatValue(v)}`);
  if (result.error) lines.push(`error: ${result.error}`);
  return lines;
}

export function resultsJson(results: Results): string {
  return JSON.stringify(results, null, 2);
}

export type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'missing';

export function availabilityOf(raw: unknown): Availability {
  const known = ['available', 'downloadable', 'downloading', 'unavailable'];
  return typeof raw === 'string' && known.includes(raw) ? (raw as Availability) : 'missing';
}
