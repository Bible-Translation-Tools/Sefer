/**
 * A local span ring: `span(name, note)` returns the closer, and the whole thing
 * is inert until someone is listening.
 *
 * Deliberately not Effect and deliberately not Observability: these spans wrap
 * work inside `changeFilter` and `transactionFilter`, thousands of times per
 * paragraph typed. `armed()` is false in the ordinary case, and then a span is
 * two `performance.now()` calls and no allocation. `src/editor/observability.ts`
 * is the one bridge to Sefer's ring, and it forwards verdicts, not spans.
 *
 * `onDerived` is how these spans reach the transaction trace
 * (`core/instrument.ts`): a span here cannot see an `EditorState`, so instead
 * of plumbing one through every derivation the closer calls back and the entry
 * lands on whichever trace is open. Registered once, at module load; when no
 * trace is open the callback returns immediately.
 */

export interface TimingSpan {
  name: string;
  ms: number;
  note: string;
  at: number;
  seq: number;
}

export interface SpanTotal {
  ms: number;
  n: number;
}

export type Gesture = ReadonlyMap<string, SpanTotal>;

const RING = 60;
const ring: TimingSpan[] = [];
let seq = 0;
const listeners = new Set<() => void>();
let bucket: Map<string, SpanTotal> | null = null;
let stack: number[] | null = null;

export const recent = (): readonly TimingSpan[] => ring;

/**
 * A closed span, for whoever is assembling the wider picture. ONE listener —
 * `core/instrument.ts` — because this is a bridge, not a bus. Called for every
 * span, armed or not, so the trace sees the derivation pipeline without the
 * `performance.mark` machinery being switched on.
 */
type Derived = (name: string, note: string, ms: number) => void;

let derived: Derived | null = null;

export const onDerived = (fn: Derived): void => {
  derived = fn;
};

export const armed = (): boolean => listeners.size > 0 || bucket !== null;

export function onSpan(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function openGesture(): void {
  bucket = new Map();
  stack = [];
}

export function closeGesture(): Gesture | null {
  const held = bucket;
  bucket = null;
  stack = null;
  return held;
}

export function summary(): { name: string; n: number; last: number; avg: number; max: number }[] {
  const by = new Map<string, { n: number; last: number; sum: number; max: number }>();
  for (const s of ring) {
    const e = by.get(s.name) ?? { n: 0, last: s.ms, sum: 0, max: 0 };
    e.n++;
    e.sum += s.ms;
    e.max = Math.max(e.max, s.ms);
    by.set(s.name, e);
  }
  return [...by].map(([name, e]) => ({
    name,
    n: e.n,
    last: e.last,
    avg: +(e.sum / e.n).toFixed(2),
    max: +e.max.toFixed(2),
  }));
}

export function span(name: string, note: string | (() => string) = ""): () => number {
  const t0 = performance.now();
  if (listeners.size === 0 && bucket === null)
    return () => {
      const ms = +(performance.now() - t0).toFixed(3);
      derived?.(name, typeof note === "function" ? note() : note, ms);
      return ms;
    };
  const mark = `${name}-${seq}`;
  performance.mark(`${mark}-start`);
  const frame = stack ? stack.push(0) - 1 : -1;
  return () => {
    const ms = +(performance.now() - t0).toFixed(3);
    performance.mark(`${mark}-end`);
    try {
      performance.measure(name, `${mark}-start`, `${mark}-end`);
    } catch {}
    if (stack && bucket && frame >= 0 && frame < stack.length) {
      const kids = stack[frame];
      stack.length = frame;
      if (frame > 0) stack[frame - 1] += ms;
      const held = bucket.get(name) ?? { ms: 0, n: 0 };
      held.ms = +(held.ms + ms - kids).toFixed(3);
      held.n++;
      bucket.set(name, held);
    }
    const entry: TimingSpan = {
      name,
      ms,
      note: typeof note === "function" ? note() : note,
      at: Math.round(t0),
      seq: seq++,
    };
    ring.unshift(entry);
    if (ring.length > RING) ring.length = RING;
    derived?.(name, entry.note, ms);
    for (const fn of listeners) fn();
    return ms;
  };
}
