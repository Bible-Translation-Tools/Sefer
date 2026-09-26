/**
 * The index builder, off the main thread.
 *
 * Building en_ulb's index is ~4 s of inflating and parsing, and a page that
 * does it cannot scroll. A dedicated worker has the same origin and so the
 * same OPFS; it opens the filesystem itself (the OPFS layer needs nothing but
 * `navigator.storage`), reads the repository through the pack view, and posts
 * the index back.
 *
 * It reads under a SHARED Web Lock on the repository, `sefer.git:<root>`, so a
 * writer that takes the exclusive lock (a commit, a fetch, a deepen) waits for
 * it and it waits for them. The app's own writers do not take the lock yet —
 * that is the one-writer rule the plan asks for, and this is its reader half.
 *
 * Messages are plain data: the page owns observability, so the worker reports
 * timings and the page records them as spans inside its operation.
 */

import { Effect, FileSystem } from "effect";

import { nodeFsView } from "#core/fileSystem/nodeView";
import { OpfsFileSystemLive } from "#platform/web/fileSystem";

import { buildBookIndex, type BookIndex, type BuildReport } from "./bookIndex";
import { packView } from "./packView";

export interface BuildRequest {
  readonly kind: "build";
  readonly root: string;
  readonly previous?: BookIndex | undefined;
}

export type WorkerMessage =
  | { readonly kind: "progress"; readonly seen: number }
  | {
      readonly kind: "built";
      readonly index: BookIndex;
      readonly report: BuildReport;
      readonly timings: {
        readonly lockWaitMs: number;
        readonly packLoadMs: number;
        readonly packBytes: number;
        readonly passedThrough: number;
        readonly calls: Readonly<Record<string, number>>;
        readonly walkMs: number;
      };
    }
  | { readonly kind: "failed"; readonly error: string };

export const lockName = (root: string): string => `sefer.git:${root}`;

const post = (message: WorkerMessage): void => {
  self.postMessage(message);
};

const build = async (request: BuildRequest): Promise<void> => {
  const fileSystem = await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        return yield* FileSystem.FileSystem;
      }),
      OpfsFileSystemLive,
    ),
  );
  const view = packView(nodeFsView(fileSystem, Effect.runPromise), request.root);
  const asked = performance.now();
  await navigator.locks.request(lockName(request.root), { mode: "shared" }, async () => {
    const lockWaitMs = performance.now() - asked;
    const loadStart = performance.now();
    // Loading the packs up front, so their cost is its own number.
    await view.fs.readdir(`${request.root}/.git/objects/pack`);
    const packLoadMs = performance.now() - loadStart;
    const walkStart = performance.now();
    const { index, report } = await buildBookIndex(view.fs, request.root, {
      previous: request.previous,
      onProgress: (seen) => post({ kind: "progress", seen }),
    });
    post({
      kind: "built",
      index,
      report,
      timings: {
        lockWaitMs,
        packLoadMs,
        packBytes: view.stats().packBytes,
        passedThrough: view.stats().passedThrough,
        calls: view.stats().calls,
        walkMs: performance.now() - walkStart,
      },
    });
  });
};

self.onmessage = (event: MessageEvent<BuildRequest>) => {
  build(event.data).catch((cause: unknown) =>
    post({ kind: "failed", error: cause instanceof Error ? cause.message : String(cause) }),
  );
};
