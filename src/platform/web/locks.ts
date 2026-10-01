/**
 * The repository lock over the Web Locks API.
 *
 * `navigator.locks` is shared by every page, worker and tab on the origin, so
 * one lock name per repository is the one-writer rule across all of them —
 * which is the reason for this over an in-process lock. The desktop webviews
 * (WebKit, WebView2) have it too.
 *
 * A lock is held for as long as the promise handed to `request` is pending, so
 * acquiring one here means resolving that promise later, when the Effect that
 * holds it ends. Waiting is interruptible through the request's `signal`; a
 * grant that lands after the waiting fiber was interrupted is handed straight
 * back rather than held by nobody.
 */
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
        // An abort while waiting rejects the request; the fiber is already
        // gone, so there is no one to tell.
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
