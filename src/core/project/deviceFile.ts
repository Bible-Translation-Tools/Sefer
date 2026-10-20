import { Effect, FileSystem, type PlatformError } from "effect";

import { writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath } from "../fileSystem/path";

export const readDeviceFile = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  name: string,
): Effect.Effect<string | undefined> => {
  const path = joinPath(root, name);
  return Effect.flatMap(
    Effect.orElseSucceed(fileSystem.exists(path), () => false),
    (exists) =>
      exists
        ? Effect.orElseSucceed(fileSystem.readFileString(path), () => undefined)
        : Effect.succeed(""),
  );
};

export const writeDeviceFile = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  name: string,
  text: string,
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    yield* fileSystem.makeDirectory(joinPath(root, ".sefer"), { recursive: true });
    yield* writeFileStringAtomic(fileSystem, joinPath(root, name), text);
  });
