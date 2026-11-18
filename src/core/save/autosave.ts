import type { Book, BookId } from "@wycliffeassociates/sefer-text/book";
import { Context, Effect, Layer, Option, PubSub, Result, Scope, Semaphore, Stream } from "effect";

import { Observability } from "../observability";
import type { Project } from "../project/project";
import { debounced, type DebouncePolicy } from "../schedule/debounce";
import { SaveCoordinator } from "./saveCoordinator";

/**
 * Where autosave stands, each time that changes: `pending` once an edit is
 * waiting to be written, `written` when every waiting book is on disk,
 * `failed` when a write did not land (those books stay waiting and go again
 * with the next edit or flush).
 */
export type AutosaveState =
  | { readonly kind: "pending" }
  | { readonly kind: "written" }
  | { readonly kind: "failed"; readonly books: number; readonly reason: string };

export interface AutosaveService {
  /** Follow a project's edits; returns the unmount. */
  readonly mount: (project: Project) => () => void;
  readonly states: () => Stream.Stream<AutosaveState>;
  readonly setPolicy: (policy: DebouncePolicy) => Effect.Effect<void>;
  /** Write every waiting book now (blur, switching book, closing). */
  readonly flush: Effect.Effect<void>;
  /**
   * Run `effect` with autosave stood aside: whatever is waiting is written
   * first, and nothing is written while it runs. Sync wraps a transfer in
   * this, because it puts the incoming text into open books as ordinary edits
   * and writes the files itself; edits made meanwhile go once it is done.
   */
  readonly hold: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

export class Autosave extends Context.Service<Autosave, AutosaveService>()("Autosave") {}

export interface AutosaveOptions {
  readonly policy?: DebouncePolicy;
  readonly cause?: () => string | undefined;
}

/** A second or so after typing stops, and at least every five seconds while it does not. */
export const DEFAULT_AUTOSAVE_POLICY: DebouncePolicy = { idleMs: 1500, maxIntervalMs: 5000 };

const make = (
  options: AutosaveOptions,
): Effect.Effect<AutosaveService, never, SaveCoordinator | Scope.Scope> =>
  Effect.gen(function* () {
    const save = yield* SaveCoordinator;
    const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
    const waiting = new Map<BookId, Book>();
    const states = yield* PubSub.sliding<AutosaveState>({ capacity: 16 });
    const announce = (state: AutosaveState): void => {
      PubSub.publishUnsafe(states, state);
    };
    // One writer at a time: a flush, or a hold getting ready.
    const turn = Semaphore.makeUnsafe(1);
    let held = 0;
    let causedBy: string | undefined;

    const write = Effect.gen(function* () {
      if (held > 0 || waiting.size === 0) return;
      const books = [...waiting.values()];
      waiting.clear();
      const cause = causedBy;
      causedBy = undefined;
      const writing = observability?.operation(
        "autosave.write",
        { "autosave.books": books.length },
        cause === undefined ? undefined : { cause },
      );
      let failed = 0;
      let reason = "";
      let wrote = 0;
      for (const book of books) {
        if (!save.unwritten(book)) continue;
        const saved = yield* Effect.result(save.save(book));
        if (Result.isFailure(saved)) {
          failed += 1;
          reason = saved.failure.description;
          if (!waiting.has(book.id)) waiting.set(book.id, book);
        } else wrote += 1;
      }
      writing?.end(failed > 0 ? "failed" : "passed", {
        "autosave.wrote": wrote,
        "autosave.failed": failed,
      });
      if (failed > 0) announce({ kind: "failed", books: failed, reason });
      else announce(waiting.size > 0 ? { kind: "pending" } : { kind: "written" });
    });

    const flush = Semaphore.withPermit(turn, write);

    let policy: DebouncePolicy = options.policy ?? DEFAULT_AUTOSAVE_POLICY;
    const arm = yield* debounced(
      {
        get idleMs() {
          return policy.idleMs;
        },
        get maxIntervalMs() {
          return policy.maxIntervalMs;
        },
      },
      flush,
    );

    const hold = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.acquireUseRelease(
        Semaphore.withPermit(
          turn,
          Effect.flatMap(write, () =>
            Effect.sync(() => {
              held += 1;
            }),
          ),
        ),
        () => effect,
        () =>
          Effect.sync(() => {
            held -= 1;
            if (held === 0 && waiting.size > 0) arm();
          }),
      );

    return {
      states: () => Stream.fromPubSub(states),
      mount: (project) => {
        const stop = project.edits(({ bookId, book }) => {
          waiting.set(bookId, book);
          causedBy = options.cause?.() ?? causedBy;
          announce({ kind: "pending" });
          arm();
        });
        observability?.note("autosave.mount", "ready", undefined, {
          "project.books": project.books.length,
        });
        return () => {
          stop();
          waiting.clear();
        };
      },
      setPolicy: (next) =>
        Effect.sync(() => {
          policy = next;
        }),
      flush,
      hold,
    };
  });

export const AutosaveLive = (
  options: AutosaveOptions = {},
): Layer.Layer<Autosave, never, SaveCoordinator> => Layer.effect(Autosave, make(options));

/** `hold` when an Autosave is in context; the effect as it is otherwise (tests, the bench). */
export const standingAside = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.serviceOption(Autosave), (autosave) =>
    Option.isSome(autosave) ? autosave.value.hold(effect) : effect,
  );
