/**
 * One owner for "may I touch `.git` now", per repository.
 *
 * isomorphic-git has no locking, a Web page can have a worker and other tabs
 * on the same OPFS repository, and libgit2 on desktop is reached from more
 * than one window. So every mutation of a repository — commit, fetch, a
 * branch move, a clone into a folder — runs in that repository's EXCLUSIVE
 * lane, and every read that walks refs or the index runs in its SHARED lane.
 * Reading immutable objects by id needs neither.
 *
 * Two halves:
 *
 * - `step` is the lifecycle as a pure transition function: one state and one
 *   event in, the next state or a refusal out. The order of its cases is the
 *   policy, the way `sync/state.ts`'s ladder is.
 * - `Repositories` runs work in a lane, over the `RepositoryLock` port (Web
 *   Locks in a browser or webview, an in-process lock elsewhere), and keeps
 *   each root's state where a screen can watch it.
 *
 * A lane is re-entrant for the fiber holding it: work already inside a
 * root's exclusive lane runs any further Git or Remote call on that root
 * directly. Web Locks are not re-entrant, so without this a transaction that
 * holds the lane and then commits through the port would wait on itself.
 */
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

/** Kinds that bring a repository into being, so they may start from `absent`. */
const CREATES: ReadonlySet<WriteKind> = new Set(["init", "clone"]);

/**
 * Kinds an unhealthy repository still allows: the tools that repair it. Only
 * aborting a half-finished merge exists today.
 */
const REPAIRS: ReadonlySet<WriteKind> = new Set(["abort-merge"]);

export type RepositoryState =
  /** No repository at this root, as far as the last look could tell. */
  | { readonly _tag: "absent" }
  /** Being looked at: does a repository open here? */
  | { readonly _tag: "opening" }
  | { readonly _tag: "ready" }
  /** This context holds the exclusive lane for `kind`. */
  | { readonly _tag: "busy"; readonly kind: WriteKind }
  /**
   * The repository cannot be trusted right now: it did not open, or a caller
   * said it broke. The next write looks again, so a failure that has passed
   * (a slow disk, a tab mid-clone) does not strand it for the session.
   */
  | { readonly _tag: "unhealthy"; readonly reason: string }
  /** The project is closing: new work is refused while running work ends. */
  | { readonly _tag: "closing" };

type RepositoryEvent =
  | { readonly _tag: "open" }
  | { readonly _tag: "opened" }
  | { readonly _tag: "missing" }
  | { readonly _tag: "begin"; readonly kind: WriteKind }
  /** `ok: false` from a creating kind returns the root to `absent`. */
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

/** Why `step` said no, in words a note or an error can carry. */
interface Refusal {
  readonly refused: string;
}

const refuse = (refused: string): Refusal => ({ refused });

const isRefusal = (value: RepositoryState | Refusal): value is Refusal => "refused" in value;

/**
 * The lifecycle. Closing outranks everything, because a project that is
 * going away must not start new work; unhealthy outranks ordinary work,
 * because a repository that stopped part-way is not one to write to again
 * without a person looking.
 */
const step = (from: RepositoryState, event: RepositoryEvent): RepositoryState | Refusal => {
  if (from._tag === "closing") {
    // Work that was running when the close began may still end; it ends
    // into `closing`, and only `closed` leaves it.
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
          // The lock serialises writers, so a second begin in this context
          // means a lane was entered without it: a bug, said plainly.
          return refuse(`already busy: ${from.kind}`);
      }
      return refuse("unreachable");
    case "end":
      if (from._tag !== "busy") return refuse("nothing is running");
      return !event.ok && CREATES.has(from.kind) ? state.absent : state.ready;
  }
};

/**
 * `Refused` — the lifecycle said no before the repository was touched: the
 * project is closing, the repository needs repair, or there is none.
 */
export class RepositoryError extends Data.TaggedError("RepositoryError")<{
  readonly root: string;
  readonly description: string;
}> {}

export type LockMode = "shared" | "exclusive";

/**
 * A named lock with shared and exclusive holders, held for the length of an
 * Effect and released however it ends. The Web answers it with Web Locks,
 * which span the page, its workers and its other tabs.
 */
interface RepositoryLockService {
  readonly hold: (
    name: string,
    mode: LockMode,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

export class RepositoryLock extends Context.Service<RepositoryLock, RepositoryLockService>()(
  "RepositoryLock",
) {}

/** More readers than this at once simply wait; there are never that many. */
const READERS = 1024;

/**
 * The lock within one JavaScript context: a semaphore per name, where a
 * shared holder takes one permit and an exclusive holder takes them all.
 * Enough for Node and for a host with no Web Locks; it does not reach
 * another tab or a worker.
 */
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

/** The roots whose lane the current fiber holds, and in which mode. */
const Held = Context.Reference<ReadonlyMap<string, LockMode>>("sefer/RepositoryLanesHeld", {
  defaultValue: () => new Map(),
});

const lockName = (root: string): string => `sefer.git:${normalisePath(root)}`;

export interface RepositoriesService {
  /** The root's lifecycle state, and every change to it. */
  readonly state: (root: string) => Stream.Stream<RepositoryState>;
  /**
   * Runs `effect` in the root's shared lane: refs and the index hold still
   * while it reads. Refused only while the project is closing.
   */
  readonly shared: <A, E, R>(
    root: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RepositoryError, R>;
  /**
   * Runs `effect` in the root's exclusive lane as a `kind` mutation. The
   * lifecycle is asked first — a closing, unhealthy or absent repository
   * refuses what it cannot take — and the root is looked at once, the first
   * time it is used, so callers never have to open it themselves.
   */
  readonly exclusive: <A, E, R>(
    root: string,
    kind: WriteKind,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RepositoryError, R>;
  /** Marks the repository as needing repair; its reason is what a person reads. */
  readonly broke: (root: string, reason: string) => Effect.Effect<void>;
  /**
   * Refuses new work, waits for running work to end, then forgets the root.
   * The next use looks at it afresh.
   */
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

  /** The root's state cell, created on first use and looked at once. */
  const cell = (root: string): Effect.Effect<SubscriptionRef.SubscriptionRef<RepositoryState>> =>
    Effect.gen(function* () {
      const existing = refs.get(root);
      if (existing !== undefined) return existing;
      const created = yield* SubscriptionRef.make<RepositoryState>(state.absent);
      refs.set(root, created);
      yield* look(root, created);
      return created;
    });

  /** Applies one event; a refusal is returned, never thrown. */
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

  /**
   * Does a repository open here? Answered under the shared lane, so a
   * concurrent init or clone in another tab is seen whole or not at all.
   */
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
      // `absent` may be stale: another tab or window can have made the
      // repository since this one looked. Look again before a write that
      // needs one, and before the exclusive lock is held, since the look
      // takes the shared lock.
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
        // Taking the exclusive lock is how "running work has ended" is known:
        // it is granted only once every holder, here or in another tab, lets go.
        yield* lock.hold(lockName(root), "exclusive")(apply(root, ref, { _tag: "closed" }));
        refs.delete(root);
        observability?.note("repository.close", "consumed", undefined, { "repository.root": root });
      }),
  } satisfies RepositoriesService;
});

/**
 * Takes the host's UNWRAPPED `Git`: the lifecycle looks at a repository with
 * `open`, and a lane must not be asked for from inside the look.
 */
export const RepositoriesLive: Layer.Layer<Repositories, never, Git | RepositoryLock> =
  Layer.effect(Repositories, make);
