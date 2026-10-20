// fallow-ignore-file unused-file
import { Effect, FileSystem, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { MemoryFileSystemLive } from "../fileSystem/memory";
import { Git, type Repo } from "./git";

const AUTHOR = { name: "Sefer", email: "sefer@example.test" } as const;

const BOOK = "\\id GEN\n\\c 1\n\\v 1 In the beginning.\n";

const STAMP = { revision: 1, length: BOOK.length } as const;

export const gitContract = (
  name: string,
  makeLayer: () => Layer.Layer<Git, never, FileSystem.FileSystem>,
  makeFileSystemLayer: () => Layer.Layer<FileSystem.FileSystem> = () => MemoryFileSystemLive(),
): void => {
  const run = <A>(
    body: (fileSystem: FileSystem.FileSystem, root: string) => Effect.Effect<A, unknown, Git>,
  ): Promise<A> =>
    Effect.runPromise(
      Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const fileSystem = yield* FileSystem.FileSystem;
            const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "sefer-git-" });
            return yield* body(fileSystem, root);
          }),
        ),
        Layer.provideMerge(makeLayer(), makeFileSystemLayer()),
      ),
    );

  describe(`Git contract: ${name}`, () => {
    it("commits one saved file and reads it back through history", async () => {
      const outcome = await run((fileSystem, root) =>
        Effect.gen(function* () {
          const service = yield* Git;
          const repo: Repo = yield* service.init(root);

          const before = yield* service.status(repo);
          expect(before.changed).toEqual([]);

          const path = `${root}/book.usfm`;
          yield* fileSystem.writeFileString(path, BOOK);

          const id = yield* service.commit(repo, [{ path, stamp: STAMP }], "save GEN", AUTHOR);

          const log = yield* service.log(repo);
          const bytes = yield* service.show(repo, id, path);
          const versions = yield* service.previousVersions(repo, path);
          const newest = versions.at(0);
          const versionBytes =
            newest === undefined ? "" : new TextDecoder().decode(yield* newest.bytes());
          return {
            commits: log.length,
            message: log[0]?.message,
            author: log[0]?.author.name,
            shown: new TextDecoder().decode(bytes),
            versions: versions.length,
            versionBytes,
          };
        }),
      );

      expect(outcome).toEqual({
        commits: 1,
        message: "save GEN",
        author: AUTHOR.name,
        shown: BOOK,
        versions: 1,
        versionBytes: BOOK,
      });
    });
  });
};
