/** Disposable OPFS fixture used only for a real-browser prototype check. */
import { Buffer } from "buffer";

import { Effect, FileSystem } from "effect";
import git from "isomorphic-git";

import { nodeFsView } from "#core/fileSystem/nodeView";
import { OpfsFileSystemLive } from "#platform/web/fileSystem";

Object.assign(globalThis, { Buffer });

const ROOT = "/sefer/projects/history-diff-spike-fixture";
const PATH = "01-GEN.usfm";
const BEFORE = String.raw`\id GEN
\usfm 3.0
\c 1
\p
\v 1 In the beginning God created the heavens and the earth.
\v 2 The earth was without form and empty.
\c 2
\p
\v 1 These are the generations of the heavens and the earth.`;
const AFTER = String.raw`\id GEN
\usfm 3.0
\c 1
\p
\v 1 At the beginning God created the heavens and the earth.
\v 2 The earth was without form and empty.
\c 2
\p
\v 1 These are the generations of the heavens and the earth made new.`;

export const seedHistoryDiffFixture = async (): Promise<string> =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          if (yield* fs.exists(ROOT)) yield* fs.remove(ROOT, { recursive: true, force: true });
          yield* fs.makeDirectory(ROOT, { recursive: true });
          const view = nodeFsView(fs, Effect.runPromise);
          yield* Effect.promise(() => git.init({ fs: view, dir: ROOT, defaultBranch: "main" }));
          yield* fs.writeFileString(`${ROOT}/${PATH}`, BEFORE);
          yield* Effect.promise(() => git.add({ fs: view, dir: ROOT, filepath: PATH }));
          yield* Effect.promise(() =>
            git.commit({
              fs: view,
              dir: ROOT,
              message: "Create prototype fixture book",
              author: { name: "Sefer scratch fixture", email: "fixture@example.invalid" },
            }),
          );
          yield* fs.writeFileString(`${ROOT}/${PATH}`, AFTER);
          yield* Effect.promise(() => git.add({ fs: view, dir: ROOT, filepath: PATH }));
          yield* Effect.promise(() =>
            git.commit({
              fs: view,
              dir: ROOT,
              message: "Change verses in two chapters",
              author: { name: "Sefer scratch fixture", email: "fixture@example.invalid" },
            }),
          );
          return ROOT;
        }),
      ),
      OpfsFileSystemLive,
    ),
  );

export const removeHistoryDiffFixture = async (): Promise<void> =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          if (yield* fs.exists(ROOT)) yield* fs.remove(ROOT, { recursive: true, force: true });
        }),
      ),
      OpfsFileSystemLive,
    ),
  );
