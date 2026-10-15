/**
 * `.sefer/project.json`: what THIS DEVICE remembers about one project.
 *
 * Read whenever the project is reopened, never committed (intake excludes
 * `.sefer/`), and never another tool's business. Today it holds:
 *
 *   name             a rename made here (`ProjectAdmin.rename`)
 *   referencePicks   which Library text the reference column shows, per
 *                    role — "on this project I usually read that source
 *                    text", a pick and not a manifest fact (Will, 2026-10-06)
 *
 * One reader and one merging writer, so a rename never erases the picks and
 * a pick never erases the name. Keys this build does not know are kept as
 * they were: a newer build may have written them.
 *
 * A team fact (an approval, a suppression) does NOT belong here: this file
 * never reaches a teammate (`planning/items/2026-10-06-project-state-and-suppressions.mdx`).
 */

import { Effect, FileSystem, type PlatformError } from "effect";

import { writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath } from "../fileSystem/path";

export const PROJECT_STATE_FILE = ".sefer/project.json";

/** The file as an open record; an absent or unreadable file is an empty one. */
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

/** Merges `patch` over what the file holds and writes it atomically. */
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
