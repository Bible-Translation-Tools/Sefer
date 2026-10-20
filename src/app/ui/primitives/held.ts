import { Cause, Effect, Exit, Fiber } from "effect";
import { createEffect, createSignal, type Accessor } from "solid-js";

import { PENDING_MS } from "./DelayedSpinner";

export interface HeldDefect {
  readonly _tag: "Defect";
  readonly description: string;
}

export interface Held<Q, T, E> {
  readonly value: Accessor<T | undefined>;
  readonly answered: Accessor<Q | undefined>;
  readonly failure: Accessor<E | HeldDefect | undefined>;
  readonly late: Accessor<boolean>;
}

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
              if (Cause.hasInterruptsOnly(exit.cause)) return;
              const error = exit.cause.reasons.find(Cause.isFailReason);
              setValue(undefined);
              setAnswered(() => asked);
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
      // Returned, not onCleanup: a Solid 2 effect's callback has no owner (NO_OWNER_CLEANUP).
      return () => {
        clearTimeout(timer);
        Effect.runFork(Fiber.interrupt(fiber));
      };
    },
  );

  return { value, answered, failure, late };
};
