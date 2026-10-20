import { Duration, Effect, Latch, Scope } from "effect";

export interface DebouncePolicy {
  readonly idleMs: number;
  readonly maxIntervalMs: number;
}

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
        for (;;) {
          const now = Date.now();
          const untilQuiet = policy.idleMs - (now - lastArmed);
          const untilDeadline = policy.maxIntervalMs - (now - burstStarted);
          const wait = Math.min(untilQuiet, untilDeadline);
          if (wait <= 0) break;
          yield* Effect.sleep(Duration.millis(wait));
        }
        armed = false;
        latch.closeUnsafe();
        yield* work;
      }),
    );

    yield* Effect.forkScoped(loop);
    return arm;
  });
