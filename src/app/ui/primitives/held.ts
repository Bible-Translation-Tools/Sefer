/**
 * `createHeld`: the ONE way a pane consumes a resource handle — the pending
 * policy as a primitive (plan §3, "`Held`").
 *
 * Every handle call is an Effect. When the question changes (the reader
 * moved to another verse) the call in flight is interrupted and a new one
 * starts; meanwhile the LAST ANSWER stays on screen, undimmed, and `late`
 * turns true only once a wait has outlasted `PENDING_MS`, for a
 * `DelayedSpinner`. A pane that wrote its own loading state would flicker
 * differently from the next one, and "it feels synchronous" dies by a
 * thousand of those.
 */

import { Cause, Effect, Exit, Fiber } from "effect";
import { createEffect, createSignal, type Accessor } from "solid-js";

import { PENDING_MS } from "./DelayedSpinner";

/** A load that died rather than failing (a throw inside a handle): still said, never a spinner. */
export interface HeldDefect {
  readonly _tag: "Defect";
  readonly description: string;
}

export interface Held<Q, T, E> {
  /** The last answer, kept while the next is on its way. */
  readonly value: Accessor<T | undefined>;
  /** The question `value` (or `failure`) answers: what to label the answer with. */
  readonly answered: Accessor<Q | undefined>;
  /** Why the last question had no answer; cleared by the next answer. */
  readonly failure: Accessor<E | HeldDefect | undefined>;
  /** A question has been waiting longer than `PENDING_MS`. */
  readonly late: Accessor<boolean>;
}

/**
 * Holds the answer to `load(question())`. `question` is read reactively; an
 * `undefined` question asks nothing and keeps what is held. `same` decides
 * when two questions are one (an Address compared by its code), so a caret
 * moving inside a verse asks nothing new.
 */
export const createHeld = <Q, T, E>(
  question: () => Q | undefined,
  load: (question: Q) => Effect.Effect<T, E>,
  same: (a: Q, b: Q) => boolean = Object.is,
): Held<Q, T, E> => {
  const [value, setValue] = createSignal<T | undefined>(undefined, { name: "heldValue" });
  const [answered, setAnswered] = createSignal<Q | undefined>(undefined, {
    name: "heldAnswered",
  });
  const [failure, setFailure] = createSignal<E | HeldDefect | undefined>(undefined, {
    name: "heldFailure",
  });
  const [late, setLate] = createSignal(false, { name: "heldLate" });

  createEffect(
    (previous: Q | undefined) => {
      const next = question();
      return next !== undefined && previous !== undefined && same(next, previous) ? previous : next;
    },
    (asked) => {
      if (asked === undefined) return;
      const timer = setTimeout(() => setLate(true), PENDING_MS);
      const fiber = Effect.runFork(
        Effect.exit(load(asked)).pipe(
          Effect.tap((exit) =>
            Effect.sync(() => {
              clearTimeout(timer);
              setLate(false);
              if (Exit.isSuccess(exit)) {
                setValue(() => exit.value);
                setAnswered(() => asked);
                setFailure(undefined);
                return;
              }
              // An interruption is the next question taking over: not a failure.
              if (Cause.hasInterruptsOnly(exit.cause)) return;
              const error = exit.cause.reasons.find(Cause.isFailReason);
              setValue(undefined);
              setAnswered(() => asked);
              // A defect (a throw inside the load) is said too, or the pane
              // would wait on a spinner for an answer that is never coming.
              setFailure(() =>
                error === undefined
                  ? ({
                      _tag: "Defect",
                      description: String(Cause.squash(exit.cause)),
                    } satisfies HeldDefect)
                  : error.error,
              );
            }),
          ),
        ),
      );
      // Returned, not `onCleanup`: a Solid 2 effect's cleanup is its return.
      return () => {
        clearTimeout(timer);
        Effect.runFork(Fiber.interrupt(fiber));
      };
    },
  );

  return { value, answered, failure, late };
};
