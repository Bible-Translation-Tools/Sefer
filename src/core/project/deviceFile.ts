/**
 * One file in a project's `.sefer/`: this device's own, never committed,
 * never in a zip (intake and export leave `.sefer/` out).
 *
 * The one helper suppressions and key-term approvals are read and written
 * through, each in its own file
 * (`planning/items/2026-10-06-project-state-and-suppressions.mdx`).
 */

import { Effect, FileSystem, type PlatformError } from "effect";

import { writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath } from "../fileSystem/path";

/**
 * The file's text: `""` when it does not exist yet, `undefined` when it exists
 * and could not be read — the case a writer must not save over.
 */
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

/** Writes the file atomically, making `.sefer/` first. */
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
