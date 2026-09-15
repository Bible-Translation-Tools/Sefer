/**
 * Combine, end to end, over real git objects.
 *
 * Two repositories in one in-memory file system — this device and the shared
 * project — and a transport that moves loose objects between them, because
 * isomorphic-git speaks smart HTTP and nothing else: there is no local or
 * file:// transport to point a second repository at. Copying `.git/objects`
 * and writing the ref is exactly what a fetch and a push leave behind, so the
 * replay below runs against genuine trees, blobs and commits rather than a
 * mocked Git.
 *
 * It lives beside the Web host rather than in `src/core/sync` because it needs
 * isomorphic-git, which core may not import. The policy half of Combine is
 * unit-tested where it belongs, in `src/core/sync/combine.test.ts`; this file
 * proves the seven steps actually compose.
 */

import { Effect, FileSystem, Layer, Option, Stream } from "effect";
import git from "isomorphic-git";
import { describe, expect, it } from "vitest";

import { MemoryFileSystemLive } from "../../core/fileSystem/memory";
import { nodeFsView } from "../../core/fileSystem/nodeView";
import { Git, type Repo } from "../../core/git/git";
import { Remote, RemoteError, type RemoteService } from "../../core/remote/remote";
import { combine, CombineError } from "../../core/sync";
import { WebGitLive } from "./git";

const AUTHOR = { name: "Sefer", email: "sefer@example.test" } as const;

const DEVICE = "/device";
const CLOUD = "/cloud";

const MARK_BASE = "\\id MRK\n\\h Mark\n\\c 1\n\\v 1 The beginning.\n";
const MARK_MINE = "\\id MRK\n\\h Mark\n\\c 1\n\\v 1 The very beginning.\n";
const LUKE_BASE = "\\id LUK\n\\h Luke\n\\c 1\n\\v 1 Many have undertaken.\n";
const LUKE_CLOUD = "\\id LUK\n\\h Luke\n\\c 1\n\\v 1 Many people have undertaken.\n";

const MARK = "41-MRK.usfm";
const LUKE = "42-LUK.usfm";

const stamp = (text: string) => ({ revision: 1, length: text.length });

/**
 * The transport: loose objects copied between two `.git` directories, and the
 * one ref each side cares about written afterwards. `failPush` is how the
 * rollback is exercised — a far side that refuses is the ordinary way step 7
 * goes wrong.
 */
const TestRemoteLive = (failPush: boolean): Layer.Layer<Remote, never, FileSystem.FileSystem> =>
  Layer.effect(
    Remote,
    Effect.map(FileSystem.FileSystem, (fileSystem): RemoteService => {
      const fs = nodeFsView(fileSystem, Effect.runPromise);
      const refused = (description: string) =>
        Effect.fail(new RemoteError({ reason: "Unavailable", description }));

      const copyObjects = (from: string, to: string) =>
        Effect.orDie(fileSystem.copy(`${from}/.git/objects`, `${to}/.git/objects`));

      const headOf = (dir: string) =>
        Effect.promise(() => git.resolveRef({ fs, dir, ref: "refs/heads/main" }));

      const writeRef = (dir: string, ref: string, value: string) =>
        Effect.promise(() => git.writeRef({ fs, dir, ref, value, force: true }));

      return {
        attach: () => refused("attach"),
        origin: () => Effect.succeed(Option.some("memory://cloud")),
        fetch: (repo) =>
          Effect.gen(function* () {
            yield* copyObjects(CLOUD, repo.root);
            yield* writeRef(repo.root, "refs/remotes/origin/main", yield* headOf(CLOUD));
            return { phase: "done", loaded: 1 };
          }),
        pull: () => refused("pull"),
        push: (repo) =>
          Effect.gen(function* () {
            if (failPush) {
              return yield* Effect.fail(
                new RemoteError({ reason: "Rejected", description: "the far side said no" }),
              );
            }
            yield* copyObjects(repo.root, CLOUD);
            yield* writeRef(CLOUD, "refs/heads/main", yield* headOf(repo.root));
            return { phase: "done", loaded: 1 };
          }),
        publish: () => refused("publish"),
        // The same two calls `WebRemoteLive` makes, for the same reason: the
        // work tree must BE the base the replay sits on.
        moveBranch: (repo, branch, toCommit) =>
          Effect.gen(function* () {
            yield* writeRef(repo.root, `refs/heads/${branch}`, toCommit);
            yield* Effect.promise(() =>
              git.checkout({ fs, dir: repo.root, ref: branch, force: true }),
            );
          }),
        abortMerge: () => refused("abortMerge"),
        progress: () => Stream.empty,
      };
    }),
  );

/**
 * Two devices that have diverged: this one rewrote Mark, the shared project
 * rewrote Luke, and both did it from the same first version.
 *
 * `contested` makes the shared project rewrite MARK instead, which is the case
 * the whole feature exists to refuse.
 */
const world = (contested: boolean) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const service = yield* Git;
    const fs = nodeFsView(fileSystem, Effect.runPromise);

    const device: Repo = yield* service.init(DEVICE);
    yield* fileSystem.writeFileString(`${DEVICE}/${MARK}`, MARK_BASE);
    yield* fileSystem.writeFileString(`${DEVICE}/${LUKE}`, LUKE_BASE);
    const first = yield* service.commit(
      device,
      [
        { path: MARK, stamp: stamp(MARK_BASE) },
        { path: LUKE, stamp: stamp(LUKE_BASE) },
      ],
      "The first version",
      AUTHOR,
    );

    // The shared project starts as a copy of that first version.
    const cloud: Repo = yield* service.init(CLOUD);
    yield* Effect.orDie(fileSystem.copy(`${DEVICE}/.git/objects`, `${CLOUD}/.git/objects`));
    yield* Effect.promise(() =>
      git.writeRef({ fs, dir: CLOUD, ref: "refs/heads/main", value: first, force: true }),
    );
    yield* Effect.promise(() => git.checkout({ fs, dir: CLOUD, ref: "main", force: true }));

    // Someone else records a version there.
    const theirPath = contested ? MARK : LUKE;
    const theirText = contested
      ? "\\id MRK\n\\h Mark\n\\c 1\n\\v 1 In the beginning.\n"
      : LUKE_CLOUD;
    yield* fileSystem.writeFileString(`${CLOUD}/${theirPath}`, theirText);
    yield* service.commit(
      cloud,
      [{ path: theirPath, stamp: stamp(theirText) }],
      "Their version",
      AUTHOR,
    );

    // This device records one of its own, on Mark, without seeing theirs.
    yield* fileSystem.writeFileString(`${DEVICE}/${MARK}`, MARK_MINE);
    const mine = yield* service.commit(
      device,
      [{ path: MARK, stamp: stamp(MARK_MINE) }],
      "My version",
      AUTHOR,
    );

    return { device, first, mine };
  });

const run = <A, E>(
  failPush: boolean,
  body: Effect.Effect<A, E, Git | Remote | FileSystem.FileSystem>,
): Promise<A> =>
  Effect.runPromise(
    Effect.provide(
      body,
      Layer.provideMerge(Layer.merge(WebGitLive, TestRemoteLive(failPush)), MemoryFileSystemLive()),
    ),
  );

describe("combine, over two repositories", () => {
  it("replays this device's book as one version on top of the shared project's", async () => {
    const outcome = await run(
      false,
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const service = yield* Git;
        const { device, mine } = yield* world(false);

        const result = yield* combine({ root: DEVICE, author: AUTHOR });
        const log = yield* service.log(device);
        return {
          result,
          mine,
          messages: log.map((entry) => entry.message),
          mark: yield* fileSystem.readFileString(`${DEVICE}/${MARK}`),
          luke: yield* fileSystem.readFileString(`${DEVICE}/${LUKE}`),
          pushed: yield* service.resolve({ root: CLOUD }, "refs/heads/main"),
        };
      }),
    );

    // One version, on top of theirs, on top of the version both had.
    expect(outcome.messages).toEqual([
      "Combine: 1 book on top of the cloud",
      "Their version",
      "The first version",
    ]);
    expect(outcome.result.paths).toEqual([MARK]);
    expect(outcome.result.from).toBe(outcome.mine);
    // This device's Mark survived; the shared project's Luke arrived.
    expect(outcome.mark).toBe(MARK_MINE);
    expect(outcome.luke).toBe(LUKE_CLOUD);
    // And it was sent: the shared project is on the combined version.
    expect(Option.getOrUndefined(outcome.pushed)).toBe(outcome.result.commit);
  });

  it("refuses the whole combine when both sides changed the same book", async () => {
    const outcome = await run(
      false,
      Effect.gen(function* () {
        const service = yield* Git;
        const { device, mine } = yield* world(true);
        const failure = yield* Effect.flip(combine({ root: DEVICE, author: AUTHOR }));
        const head = yield* service.resolve(device, "HEAD");
        return { failure, mine, head: Option.getOrUndefined(head) };
      }),
    );

    expect(outcome.failure).toBeInstanceOf(CombineError);
    expect(outcome.failure.refusal).toBe("contested");
    expect(outcome.failure.state).toBe("untouched");
    expect(outcome.failure.description).toContain("MRK");
    // Nothing moved.
    expect(outcome.head).toBe(outcome.mine);
  });

  it("puts the repository back when the send fails", async () => {
    const outcome = await run(
      true,
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const service = yield* Git;
        const { device, mine } = yield* world(false);
        const failure = yield* Effect.flip(combine({ root: DEVICE, author: AUTHOR }));
        const head = yield* service.resolve(device, "HEAD");
        return {
          failure,
          mine,
          head: Option.getOrUndefined(head),
          mark: yield* fileSystem.readFileString(`${DEVICE}/${MARK}`),
          luke: yield* fileSystem.readFileString(`${DEVICE}/${LUKE}`),
        };
      }),
    );

    expect(outcome.failure.state).toBe("restored");
    expect(outcome.failure.description).toContain("Rejected");
    // Back on this device's own version, with its work tree as it was.
    expect(outcome.head).toBe(outcome.mine);
    expect(outcome.mark).toBe(MARK_MINE);
    expect(outcome.luke).toBe(LUKE_BASE);
  });
});
