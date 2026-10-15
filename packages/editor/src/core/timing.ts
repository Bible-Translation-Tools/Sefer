/**
 * Local spans: `span(name, note)` returns the closer, and the whole thing is
 * inert until the keystroke meter opens a gesture.
 *
 * Deliberately not Effect and deliberately not Observability: these spans wrap
 * work inside `changeFilter` and `transactionFilter`, thousands of times per
 * paragraph typed. `armed()` is false outside a metered gesture, and then a span is
 * two `performance.now()` calls and no allocation. `src/editor/observability.ts`
 * is the one bridge to Sefer's ring, and it forwards verdicts, not spans.
 *
 * `onDerived` is how these spans reach the transaction trace
 * (`core/instrument.ts`): a span here cannot see an `EditorState`, so instead
 * of plumbing one through every derivation the closer calls back and the entry
 * lands on whichever trace is open. Registered once, at module load; when no
 * trace is open the callback returns immediately.
 */

export interface SpanTotal {
  ms: number;
  n: number;
}

export type Gesture = ReadonlyMap<string, SpanTotal>;

let seq = 0;
let bucket: Map<string, SpanTotal> | null = null;
let stack: number[] | null = null;

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

export const armed = (): boolean => bucket !== null;

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

export function span(name: string, note: string | (() => string) = ""): () => number {
  const t0 = performance.now();
  if (bucket === null)
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
    seq++;
    derived?.(name, typeof note === "function" ? note() : note, ms);
    return ms;
  };
}
