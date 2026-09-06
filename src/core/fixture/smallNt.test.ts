import { Effect, FileSystem } from "effect";
import { expect, test } from "vitest";

import { FixtureFileSystemLive, SMALL_NT_ROOT, smallNtFileNames } from "./smallNt";

test("the seeded fixture layer lists the fixture files and reads Philemon", async () => {
  const program = Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const listed = yield* fileSystem.readDirectory(SMALL_NT_ROOT);
    const philemon = yield* fileSystem.readFileString(`${SMALL_NT_ROOT}/58-PHM.usfm`);
    return { listed, philemon };
  });

  const { listed, philemon } = await Effect.runPromise(
    Effect.provide(program, FixtureFileSystemLive),
  );

  expect(listed).toEqual(smallNtFileNames());
  expect(philemon.startsWith("\\id PHM")).toBe(true);
});
