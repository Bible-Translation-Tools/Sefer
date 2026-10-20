// referencePicks is a pick and not a manifest fact (Will, 2026-10-06).

import { Effect, FileSystem, type PlatformError } from "effect";

import { writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath } from "../fileSystem/path";

export const PROJECT_STATE_FILE = ".sefer/project.json";

export const readProjectState = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<Readonly<Record<string, unknown>>> =>
  Effect.map(
    Effect.orElseSucceed(fileSystem.readFileString(joinPath(root, PROJECT_STATE_FILE)), () => ""),
    (text) => {
      try {
        const parsed: unknown = JSON.parse(text);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? Object.fromEntries(Object.entries(parsed))
          : {};
      } catch {
        return {};
      }
    },
  );

export const updateProjectState = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  patch: Readonly<Record<string, unknown>>,
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const held = yield* readProjectState(fileSystem, root);
    yield* fileSystem.makeDirectory(joinPath(root, ".sefer"), { recursive: true });
    yield* writeFileStringAtomic(
      fileSystem,
      joinPath(root, PROJECT_STATE_FILE),
      `${JSON.stringify({ ...held, ...patch }, null, 2)}\n`,
    );
  });
