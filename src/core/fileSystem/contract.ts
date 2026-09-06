import { Effect, FileSystem, type Layer, type PlatformError, Result } from "effect";
import { describe, expect, it } from "vitest";

import { temporaryPathFor, writeFileAtomic } from "./atomic";
import { scopedTo } from "./scoped";

type Body<A> = (
  fileSystem: FileSystem.FileSystem,
  root: string,
) => Effect.Effect<A, PlatformError.PlatformError>;

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

export const fileSystemContract = (
  name: string,
  makeLayer: () => Layer.Layer<FileSystem.FileSystem>,
): void => {
  const run = <A>(body: Body<A>): Promise<A> =>
    Effect.runPromise(
      Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const fileSystem = yield* FileSystem.FileSystem;
            const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "sefer-fs-" });
            return yield* body(fileSystem, root);
          }),
        ),
        makeLayer(),
      ),
    );

  const reasonOf = <A>(
    effect: Effect.Effect<A, PlatformError.PlatformError>,
  ): Effect.Effect<string> =>
    Effect.map(Effect.result(effect), (result) =>
      Result.isFailure(result) ? result.failure.reason._tag : "succeeded",
    );

  describe(`FileSystem contract: ${name}`, () => {
    it("round trips bytes", async () => {
      const written = new Uint8Array([0x00, 0x1b, 0xff, 0x41, 0x0a]);
      const read = await run((fileSystem, root) =>
        Effect.flatMap(fileSystem.writeFile(`${root}/book.bin`, written), () =>
          fileSystem.readFile(`${root}/book.bin`),
        ),
      );
      expect([...read]).toEqual([...written]);
    });

    it("round trips a string", async () => {
      const read = await run((fileSystem, root) =>
        Effect.flatMap(fileSystem.writeFileString(`${root}/book.usfm`, "\\id GEN\n\\c 1\n"), () =>
          fileSystem.readFileString(`${root}/book.usfm`),
        ),
      );
      expect(read).toBe("\\id GEN\n\\c 1\n");
    });

    it("reports existence before and after a write", async () => {
      const seen = await run((fileSystem, root) =>
        Effect.gen(function* () {
          const before = yield* fileSystem.exists(`${root}/absent.usfm`);
          yield* fileSystem.writeFileString(`${root}/absent.usfm`, "x");
          const after = yield* fileSystem.exists(`${root}/absent.usfm`);
          return [before, after];
        }),
      );
      expect(seen).toEqual([false, true]);
    });

    it("lists directory entries", async () => {
      const entries = await run((fileSystem, root) =>
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(`${root}/project`);
          yield* fileSystem.writeFileString(`${root}/project/b.usfm`, "b");
          yield* fileSystem.writeFileString(`${root}/project/a.usfm`, "a");
          yield* fileSystem.makeDirectory(`${root}/project/nested`);
          return yield* fileSystem.readDirectory(`${root}/project`);
        }),
      );
      expect([...entries].sort()).toEqual(["a.usfm", "b.usfm", "nested"]);
    });

    it("stats file and directory kinds", async () => {
      const kinds = await run((fileSystem, root) =>
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(`${root}/kinds`);
          yield* fileSystem.writeFileString(`${root}/kinds/one.usfm`, "one");
          const file = yield* fileSystem.stat(`${root}/kinds/one.usfm`);
          const directory = yield* fileSystem.stat(`${root}/kinds`);
          return [file.type, directory.type, Number(file.size)];
        }),
      );
      expect(kinds).toEqual(["File", "Directory", 3]);
    });

    it("removes a file", async () => {
      const reason = await run((fileSystem, root) =>
        Effect.gen(function* () {
          yield* fileSystem.writeFileString(`${root}/gone.usfm`, "gone");
          yield* fileSystem.remove(`${root}/gone.usfm`);
          return yield* reasonOf(fileSystem.readFile(`${root}/gone.usfm`));
        }),
      );
      expect(reason).toBe("NotFound");
    });

    it("renames over an existing target", async () => {
      const outcome = await run((fileSystem, root) =>
        Effect.gen(function* () {
          yield* fileSystem.writeFileString(`${root}/next.usfm`, "next");
          yield* fileSystem.writeFileString(`${root}/target.usfm`, "previous");
          yield* fileSystem.rename(`${root}/next.usfm`, `${root}/target.usfm`);
          const text = yield* fileSystem.readFileString(`${root}/target.usfm`);
          const source = yield* fileSystem.exists(`${root}/next.usfm`);
          return [text, source];
        }),
      );
      expect(outcome).toEqual(["next", false]);
    });

    it("fails with NotFound when reading a missing file", async () => {
      const reason = await run((fileSystem, root) =>
        reasonOf(fileSystem.readFile(`${root}/missing.usfm`)),
      );
      expect(reason).toBe("NotFound");
    });

    it("fails with NotFound when writing into a missing directory", async () => {
      const reason = await run((fileSystem, root) =>
        reasonOf(fileSystem.writeFileString(`${root}/absent/one.usfm`, "one")),
      );
      expect(reason).toBe("NotFound");
    });

    it("fails with AlreadyExists when creating an existing directory", async () => {
      const reason = await run((fileSystem, root) =>
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(`${root}/twice`);
          return yield* reasonOf(fileSystem.makeDirectory(`${root}/twice`));
        }),
      );
      expect(reason).toBe("AlreadyExists");
    });

    it("fails with AlreadyExists on an exclusive write over an existing file", async () => {
      const reason = await run((fileSystem, root) =>
        Effect.gen(function* () {
          yield* fileSystem.writeFileString(`${root}/exclusive.usfm`, "first");
          return yield* reasonOf(
            fileSystem.writeFile(`${root}/exclusive.usfm`, bytesOf("second"), { flag: "wx" }),
          );
        }),
      );
      expect(reason).toBe("AlreadyExists");
    });

    it("atomically replaces previous bytes and leaves no temporary sibling", async () => {
      const outcome = await run((fileSystem, root) =>
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(`${root}/atomic`);
          yield* fileSystem.writeFileString(`${root}/atomic/book.usfm`, "previous");
          yield* writeFileAtomic(fileSystem, `${root}/atomic/book.usfm`, bytesOf("next"));
          const text = yield* fileSystem.readFileString(`${root}/atomic/book.usfm`);
          const entries = yield* fileSystem.readDirectory(`${root}/atomic`);
          return [text, [...entries].sort()];
        }),
      );
      expect(outcome).toEqual(["next", ["book.usfm"]]);
    });

    it("leaves the previous bytes when the atomic write cannot start", async () => {
      const outcome = await run((fileSystem, root) =>
        Effect.gen(function* () {
          const target = `${root}/blocked.usfm`;
          yield* fileSystem.writeFileString(target, "previous");
          yield* fileSystem.makeDirectory(temporaryPathFor(target));
          yield* fileSystem.writeFileString(`${temporaryPathFor(target)}/occupied`, "occupied");
          const failed = yield* Effect.map(
            Effect.result(writeFileAtomic(fileSystem, target, bytesOf("next"))),
            Result.isFailure,
          );
          const text = yield* fileSystem.readFileString(target);
          return [failed, text];
        }),
      );
      expect(outcome).toEqual([true, "previous"]);
    });

    it("removes its temporary sibling when the atomic rename fails", async () => {
      const outcome = await run((fileSystem, root) =>
        Effect.gen(function* () {
          const target = `${root}/occupied`;
          yield* fileSystem.makeDirectory(target);
          yield* fileSystem.writeFileString(`${target}/keep.usfm`, "keep");
          const failed = yield* Effect.map(
            Effect.result(writeFileAtomic(fileSystem, target, bytesOf("next"))),
            Result.isFailure,
          );
          const leftover = yield* fileSystem.exists(temporaryPathFor(target));
          const kept = yield* fileSystem.readFileString(`${target}/keep.usfm`);
          return [failed, leftover, kept];
        }),
      );
      expect(outcome).toEqual([true, false, "keep"]);
    });

    it("resolves scoped paths under the root", async () => {
      const text = await run((fileSystem, root) =>
        Effect.gen(function* () {
          const scoped = scopedTo(fileSystem, root);
          yield* scoped.makeDirectory("notes", { recursive: true });
          yield* scoped.writeFileString("notes/one.usfm", "scoped");
          return yield* fileSystem.readFileString(`${root}/notes/one.usfm`);
        }),
      );
      expect(text).toBe("scoped");
    });

    it("refuses a scoped path that escapes the root", async () => {
      const reasons = await run((fileSystem, root) =>
        Effect.gen(function* () {
          const scoped = scopedTo(fileSystem, root);
          return [
            yield* reasonOf(scoped.readFile("../outside.usfm")),
            yield* reasonOf(scoped.readFile("notes/../../outside.usfm")),
            yield* reasonOf(scoped.writeFileString("/etc/passwd", "no")),
            yield* reasonOf(scoped.rename("one.usfm", "../two.usfm")),
          ];
        }),
      );
      expect(reasons).toEqual(["BadArgument", "BadArgument", "BadArgument", "BadArgument"]);
    });

    it("allows a scoped path that returns to the root", async () => {
      const text = await run((fileSystem, root) =>
        Effect.gen(function* () {
          const scoped = scopedTo(fileSystem, root);
          yield* scoped.makeDirectory("notes", { recursive: true });
          yield* scoped.writeFileString("notes/../inside.usfm", "inside");
          return yield* fileSystem.readFileString(`${root}/inside.usfm`);
        }),
      );
      expect(text).toBe("inside");
    });
  });
};
