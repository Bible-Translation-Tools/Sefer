import { Effect, FileSystem } from "effect";
import { describe, expect, it } from "vitest";

import { fileSystemContract } from "./contract";
import { makeMemoryFileSystem, MemoryFileSystemLive } from "./memory";
import { escapesRoot, joinPath, normalisePath, parentPath } from "./path";

fileSystemContract("memory", () => MemoryFileSystemLive());

describe("memory FileSystem", () => {
  it("serves seeded entries", async () => {
    const text = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          return yield* fileSystem.readFileString("/project/book.usfm");
        }),
        MemoryFileSystemLive({ "/project/book.usfm": "\\id GEN\n" }),
      ),
    );
    expect(text).toBe("\\id GEN\n");
  });

  it("seeds after construction", async () => {
    const { fileSystem, seed } = makeMemoryFileSystem();
    seed({ "/project/nested/book.usfm": "seeded" });
    const entries = await Effect.runPromise(fileSystem.readDirectory("/project/nested"));
    expect(entries).toEqual(["book.usfm"]);
  });

  it("refuses operations it does not implement", async () => {
    const { fileSystem } = makeMemoryFileSystem();
    await expect(Effect.runPromise(fileSystem.readLink("/anything"))).rejects.toThrow(
      /not implemented/,
    );
  });
});

describe("posix path helpers", () => {
  it("normalises relative and absolute paths", () => {
    expect(normalisePath("/a/./b/../c/")).toBe("/a/c");
    expect(normalisePath("a/b/../../../c")).toBe("../c");
    expect(normalisePath("/")).toBe("/");
    expect(normalisePath("")).toBe("");
  });

  it("finds parents and joins", () => {
    expect(parentPath("/a/b")).toBe("/a");
    expect(parentPath("/a")).toBe("/");
    expect(parentPath("a")).toBe("");
    expect(joinPath("/root", "a/b")).toBe("/root/a/b");
  });

  it("detects escapes", () => {
    expect(escapesRoot("/root", "/root/a")).toBe(false);
    expect(escapesRoot("/root", "/root")).toBe(false);
    expect(escapesRoot("/root", "/rootless/a")).toBe(true);
    expect(escapesRoot("/root", "/a")).toBe(true);
  });
});
