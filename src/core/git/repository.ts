import { Context, Data, Effect, Layer, Option, Semaphore, Stream, SubscriptionRef } from "effect";

import { normalisePath } from "../fileSystem/path";
import { Observability } from "../observability";
import { Git, type GitService } from "./git";

/** The mutations the exclusive lane is taken for. */
export type WriteKind =
  | "init"
  | "clone"
  | "commit"
  | "attach"
  | "fetch"
  | "deepen"
  | "fast-forward"
  | "receive"
  | "combine"
  | "push"
  | "publish"
  | "abort-merge";

const CREATES: ReadonlySet<WriteKind> = new Set(["init", "clone"]);

const REPAIRS: ReadonlySet<WriteKind> = new Set(["abort-merge"]);

export type RepositoryState =
  | { readonly _tag: "absent" }
  | { readonly _tag: "opening" }
  | { readonly _tag: "ready" }
  /** This context holds the exclusive lane for `kind`. */
  | { readonly _tag: "busy"; readonly kind: WriteKind }
  | { readonly _tag: "unhealthy"; readonly reason: string }
  | { readonly _tag: "closing" };

type RepositoryEvent =
  | { readonly _tag: "open" }
  | { readonly _tag: "opened" }
  | { readonly _tag: "missing" }
  | { readonly _tag: "begin"; readonly kind: WriteKind }
  | { readonly _tag: "end"; readonly ok: boolean }
  | { readonly _tag: "broke"; readonly reason: string }
  | { readonly _tag: "close" }
  | { readonly _tag: "closed" };

const state = {
  absent: { _tag: "absent" },
  opening: { _tag: "opening" },
  ready: { _tag: "ready" },
  closing: { _tag: "closing" },
} as const satisfies Record<string, RepositoryState>;

interface Refusal {
  readonly refused: string;
}

const refuse = (refused: string): Refusal => ({ refused });

const isRefusal = (value: RepositoryState | Refusal): value is Refusal => "refused" in value;

const step = (from: RepositoryState, event: RepositoryEvent): RepositoryState | Refusal => {
  if (from._tag === "closing") {
    if (event._tag === "closed") return state.absent;
    if (event._tag === "end") return from;
    return refuse("the project is closing");
  }
  switch (event._tag) {
    case "close":
      return state.closing;
    case "closed":
      return refuse("nothing is closing");
    case "broke":
      return { _tag: "unhealthy", reason: event.reason };
    case "open":
      return from._tag === "busy" ? refuse(`busy: ${from.kind}`) : state.opening;
    case "opened":
      return from._tag === "opening" ? state.ready : refuse("nothing is opening");
    case "missing":
      return from._tag === "opening" ? state.absent : refuse("nothing is opening");
    case "begin":
      switch (from._tag) {
        case "ready":
          return { _tag: "busy", kind: event.kind };
        case "absent":
          return CREATES.has(event.kind)
            ? { _tag: "busy", kind: event.kind }
            : refuse("there is no repository here");
        case "unhealthy":
          return REPAIRS.has(event.kind)
            ? { _tag: "busy", kind: event.kind }
            : refuse(`the repository needs repair: ${from.reason}`);
        case "opening":
          return refuse("the repository is still opening");
        case "busy":
          return refuse(`already busy: ${from.kind}`);
      }
      return refuse("unreachable");
    case "end":
      if (from._tag !== "busy") return refuse("nothing is running");
      return !event.ok && CREATES.has(from.kind) ? state.absent : state.ready;
  }
};

export class RepositoryError extends Data.TaggedError("RepositoryError")<{
  readonly root: string;
  readonly description: string;
}> {}

export type LockMode = "shared" | "exclusive";

interface RepositoryLockService {
  readonly hold: (
    name: string,
    mode: LockMode,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

export class RepositoryLock extends Context.Service<RepositoryLock, RepositoryLockService>()(
  "RepositoryLock",
) {}

const READERS = 1024;

export const InProcessLockLive: Layer.Layer<RepositoryLock> = Layer.sync(RepositoryLock, () => {
  const locks = new Map<string, Semaphore.Semaphore>();
  return {
    hold: (name, mode) => (effect) => {
      const existing = locks.get(name);
      const lock = existing ?? Semaphore.makeUnsafe(READERS);
      if (existing === undefined) locks.set(name, lock);
      return Semaphore.withPermits(lock, mode === "shared" ? 1 : READERS, effect);
    },
  };
});

const Held = Context.Reference<ReadonlyMap<string, LockMode>>("sefer/RepositoryLanesHeld", {
  defaultValue: () => new Map(),
});

const lockName = (root: string): string => `sefer.git:${normalisePath(root)}`;

export interface RepositoriesService {
  readonly state: (root: string) => Stream.Stream<RepositoryState>;
  readonly shared: <A, E, R>(
    root: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RepositoryError, R>;
  readonly exclusive: <A, E, R>(
    root: string,
    kind: WriteKind,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RepositoryError, R>;
  readonly broke: (root: string, reason: string) => Effect.Effect<void>;
  readonly close: (root: string) => Effect.Effect<void>;
}

export class Repositories extends Context.Service<Repositories, RepositoriesService>()(
  "Repositories",
) {}

const make = Effect.gen(function* () {
  const git: GitService = yield* Git;
  const lock = yield* RepositoryLock;
  const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability));

  const refs = new Map<string, SubscriptionRef.SubscriptionRef<RepositoryState>>();

  const cell = (root: string): Effect.Effect<SubscriptionRef.SubscriptionRef<RepositoryState>> =>
    Effect.gen(function* () {
      const existing = refs.get(root);
      if (existing !== undefined) return existing;
      const created = yield* SubscriptionRef.make<RepositoryState>(state.absent);
      refs.set(root, created);
      yield* look(root, created);
      return created;
    });

  const apply = (
    root: string,
    ref: SubscriptionRef.SubscriptionRef<RepositoryState>,
    event: RepositoryEvent,
  ): Effect.Effect<Option.Option<Refusal>> =>
    SubscriptionRef.modify(ref, (from) => {
      const next = step(from, event);
      return isRefusal(next) ? [Option.some(next), from] : [Option.none(), next];
    }).pipe(
      Effect.tap((refusal) =>
        Effect.sync(() => {
          if (Option.isSome(refusal))
            observability?.note("repository.lane", "refused", refusal.value.refused, {
              "repository.root": root,
              "repository.event": event._tag,
            });
        }),
      ),
    );

  const look = (root: string, ref: SubscriptionRef.SubscriptionRef<RepositoryState>) =>
    Effect.gen(function* () {
      yield* apply(root, ref, { _tag: "open" });
      const opened = yield* lock.hold(lockName(root), "shared")(Effect.result(git.open(root)));
      if (opened._tag === "Success") {
        yield* apply(root, ref, { _tag: "opened" });
        observability?.note("repository.open", "ready", undefined, { "repository.root": root });
      } else if (opened.failure.reason === "NotARepository") {
        yield* apply(root, ref, { _tag: "missing" });
        observability?.note("repository.open", "declined", "no repository", {
          "repository.root": root,
        });
      } else {
        yield* apply(root, ref, {
          _tag: "broke",
          reason: opened.failure.description ?? "open failed",
        });
        observability?.note("repository.open", "failed", opened.failure.reason, {
          "repository.root": root,
        });
      }
    });

  const refused = (root: string, refusal: Refusal) =>
    new RepositoryError({ root, description: refusal.refused });

  const within = <A, E, R>(root: string, mode: LockMode, effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const held = yield* Held;
      return yield* Effect.provideService(effect, Held, new Map([...held, [root, mode]]));
    });

  const shared: RepositoriesService["shared"] = (path, effect) =>
    Effect.gen(function* () {
      const root = normalisePath(path);
      const held = yield* Held;
      if (held.has(root)) return yield* effect;
      const ref = yield* cell(root);
      if ((yield* SubscriptionRef.get(ref))._tag === "closing")
        return yield* Effect.fail(refused(root, refuse("the project is closing")));
      return yield* lock.hold(lockName(root), "shared")(within(root, "shared", effect));
    });

  const exclusive: RepositoriesService["exclusive"] = (path, kind, effect) =>
    Effect.gen(function* () {
      const root = normalisePath(path);
      const held = yield* Held;
      const mode = held.get(root);
      if (mode === "exclusive") return yield* effect;
      if (mode === "shared")
        return yield* Effect.die(
          new Error(`${kind} asked for the exclusive lane from inside the shared lane of ${root}`),
        );
      const ref = yield* cell(root);
      const now = (yield* SubscriptionRef.get(ref))._tag;
      if (!CREATES.has(kind) && (now === "absent" || (now === "unhealthy" && !REPAIRS.has(kind))))
        yield* look(root, ref);
      const asked = performance.now();
      return yield* lock.hold(
        lockName(root),
        "exclusive",
      )(
        Effect.gen(function* () {
          const waited = performance.now() - asked;
          const refusal = yield* apply(root, ref, { _tag: "begin", kind });
          if (Option.isSome(refusal)) return yield* Effect.fail(refused(root, refusal.value));
          const stop = observability?.span("repository.lock", undefined, {
            "repository.root": root,
            "lock.kind": kind,
            "lock.wait_ms": Math.round(waited),
          });
          return yield* within(root, "exclusive", effect).pipe(
            Effect.onExit((exit) =>
              Effect.andThen(
                apply(root, ref, { _tag: "end", ok: exit._tag === "Success" }),
                Effect.sync(() => stop?.()),
              ),
            ),
          );
        }),
      );
    });

  return {
    state: (path) => Stream.unwrap(Effect.map(cell(normalisePath(path)), SubscriptionRef.changes)),
    shared,
    exclusive,
    broke: (path, reason) =>
      Effect.gen(function* () {
        const root = normalisePath(path);
        yield* apply(root, yield* cell(root), { _tag: "broke", reason });
      }),
    close: (path) =>
      Effect.gen(function* () {
        const root = normalisePath(path);
        const ref = refs.get(root);
        if (ref === undefined) return;
        yield* apply(root, ref, { _tag: "close" });
        yield* lock.hold(lockName(root), "exclusive")(apply(root, ref, { _tag: "closed" }));
        refs.delete(root);
        observability?.note("repository.close", "consumed", undefined, { "repository.root": root });
      }),
  } satisfies RepositoriesService;
});

export const RepositoriesLive: Layer.Layer<Repositories, never, Git | RepositoryLock> =
  Layer.effect(Repositories, make);
