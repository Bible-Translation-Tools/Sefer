import { Effect, Layer } from "effect";

import { RepositoryLock, type LockMode } from "#core/git/repository";

const acquire = (name: string, mode: LockMode): Effect.Effect<() => void> =>
  Effect.callback<() => void>((resume, signal) => {
    void navigator.locks
      .request(
        name,
        { mode, signal },
        () =>
          new Promise<void>((release) => {
            if (signal.aborted) {
              release();
              return;
            }
            signal.addEventListener("abort", () => release(), { once: true });
            resume(Effect.succeed(release));
          }),
      )
      .catch((cause: unknown) => {
        if (!signal.aborted) resume(Effect.die(cause));
      });
  });

export const WebLocksLive: Layer.Layer<RepositoryLock> = Layer.succeed(RepositoryLock, {
  hold: (name, mode) => (effect) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.flatMap(restore(acquire(name, mode)), (release) =>
        Effect.ensuring(restore(effect), Effect.sync(release)),
      ),
    ),
});
