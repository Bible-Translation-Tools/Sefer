// debounce.ts
//
// One timer shape shared by the two things that write bytes off the keystroke
// path: autosave (slice 10) and the recovery journal (slice 11). Both are
// armed from a SYNCHRONOUS `book.changes` callback and must not run inside
// `apply`, so arming is a plain function that touches two numbers and opens a
// latch, and the work happens on a fiber tied to a Scope.
//
// The policy has two bounds because either alone is wrong: `idleMs` alone
// never fires while the user keeps typing, and `maxIntervalMs` alone fires in
// the middle of a burst. The fiber waits for quiet, but no longer than
// `maxIntervalMs` after the first arming of the current burst.
//
// It lives under `save/` because Save is its first caller; move it to a
// neutral core utility if a third caller appears.

import { Duration, Effect, Latch, Scope } from "effect";

export interface DebouncePolicy {
  /** Quiet time required after the last arming before the work runs. */
  readonly idleMs: number;
  /** Upper bound from the first arming of a burst; fires even under typing. */
  readonly maxIntervalMs: number;
}

/**
 * Forks the timer fiber into the current Scope and returns the synchronous
 * `arm` a change listener calls. `work` runs at most once per burst; failures
 * are the caller's to handle, so `work` must not fail (`never`) — the fiber
 * would otherwise die and silently stop debouncing.
 *
 * Arming during a run starts the next burst, so an edit that lands while a
 * save is in flight is not lost.
 */
export const debounced = (
  policy: DebouncePolicy,
  work: Effect.Effect<void>,
): Effect.Effect<() => void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const latch = Latch.makeUnsafe(false);
    let lastArmed = 0;
    let burstStarted = 0;
    let armed = false;

    const arm = (): void => {
      const now = Date.now();
      lastArmed = now;
      if (!armed) {
        armed = true;
        burstStarted = now;
      }
      latch.openUnsafe();
    };

    const loop = Effect.forever(
      Effect.gen(function* () {
        yield* latch.await;
        // Wait for whichever bound comes first, re-reading the numbers each
        // pass so arming during the wait extends the quiet period.
        for (;;) {
          const now = Date.now();
          const untilQuiet = policy.idleMs - (now - lastArmed);
          const untilDeadline = policy.maxIntervalMs - (now - burstStarted);
          const wait = Math.min(untilQuiet, untilDeadline);
          if (wait <= 0) break;
          yield* Effect.sleep(Duration.millis(wait));
        }
        // Close before the work runs: an edit that arrives while it is running
        // re-arms and is picked up by the next pass.
        armed = false;
        latch.closeUnsafe();
        yield* work;
      }),
    );

    yield* Effect.forkScoped(loop);
    return arm;
  });
