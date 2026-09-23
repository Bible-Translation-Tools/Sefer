import { Buffer } from "buffer";

import { Effect, FileSystem } from "effect";
import git from "isomorphic-git";
import { expect, it } from "vitest";

import { nodeFsView } from "#core/fileSystem/nodeView";

import { OpfsFileSystemLive } from "./fileSystem";

Object.assign(globalThis, { Buffer });

it("commits and reads back a blob through isomorphic-git over OPFS", async () => {
  const outcome = await Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const dir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "sefer-git-" });
          const fs = nodeFsView(fileSystem, Effect.runPromise);
          yield* Effect.promise(() => git.init({ fs, dir, defaultBranch: "main" }));
          yield* fileSystem.writeFileString(`${dir}/book.usfm`, "\\id GEN\n");
          yield* Effect.promise(() => git.add({ fs, dir, filepath: "book.usfm" }));
          const oid = yield* Effect.promise(() =>
            git.commit({
              fs,
              dir,
              message: "first",
              author: { name: "Sefer", email: "sefer@example.test" },
            }),
          );
          const log = yield* Effect.promise(() => git.log({ fs, dir }));
          const blob = yield* Effect.promise(() =>
            git.readBlob({ fs, dir, oid, filepath: "book.usfm" }),
          );
          return [log.length, log[0]?.commit.message.trim(), new TextDecoder().decode(blob.blob)];
        }),
      ),
      OpfsFileSystemLive,
    ),
  );
  expect(outcome).toEqual([1, "first", "\\id GEN\n"]);
});
