/**
 * An upstream resource's files, wherever they are while Sefer reads them
 * once: today a folder on a `FileSystem` (desktop's clone, the Web's clone
 * staged in memory, a picked folder); a zip's entries would be another. What
 * a kind's pack step reads (`KindRow.pack`): TN's chunk files today, TW's
 * articles and TQ's questions the same way.
 */

import { Effect, type FileSystem } from "effect";

import { joinPath } from "../../fileSystem/path";
import { Unavailable } from "./handle";

const unavailable = (reason: Unavailable["reason"], description: string): Unavailable =>
  new Unavailable({ reason, description });

/**
 * Where a resource's upstream files are read from while a pack is built.
 * Paths are relative to the resource's root, `/`-separated.
 */
export interface UpstreamTree {
  /** The bytes at `path`, or `undefined` when there is no such file. */
  readonly file: (path: string) => Effect.Effect<Uint8Array | undefined, Unavailable>;
  /** Every file below `directory`, relative to it, sorted. Empty when there is none. */
  readonly below: (directory: string) => Effect.Effect<readonly string[], Unavailable>;
  /** The bytes of several files below `directory`, by their path relative to it. */
  readonly read: (
    directory: string,
    paths: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, Uint8Array>, Unavailable>;
}

/** A resource's files in a folder. */
export const treeInFolder = (fileSystem: FileSystem.FileSystem, root: string): UpstreamTree => ({
  file: (path) =>
    Effect.map(Effect.option(fileSystem.readFile(joinPath(root, path))), (read) =>
      read._tag === "None" ? undefined : read.value,
    ),
  below: (directory) =>
    Effect.map(filesBelow(fileSystem, joinPath(root, directory)), (files) =>
      files.map((file) => file.path),
    ),
  read: (directory, paths) =>
    Effect.gen(function* () {
      const out = new Map<string, Uint8Array>();
      for (const path of paths)
        out.set(
          path,
          yield* Effect.mapError(
            fileSystem.readFile(joinPath(joinPath(root, directory), path)),
            (error) => unavailable("Unreadable", `${path}: ${error.message}`),
          ),
        );
      return out;
    }),
});

/** Every file below `directory`, relative to it, sorted, with its size and modification time. */
export const filesBelow = (
  fileSystem: FileSystem.FileSystem,
  directory: string,
): Effect.Effect<
  readonly { readonly path: string; readonly size: number; readonly mtime: number }[]
> =>
  Effect.gen(function* () {
    const entries = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(directory, { recursive: true }),
      (): readonly string[] => [],
    );
    const files: { path: string; size: number; mtime: number }[] = [];
    for (const entry of [...entries].sort()) {
      const info = yield* Effect.option(fileSystem.stat(joinPath(directory, entry)));
      if (info._tag === "None" || info.value.type !== "File") continue;
      const mtime = info.value.mtime._tag === "Some" ? info.value.mtime.value.getTime() : 0;
      files.push({ path: entry.replaceAll("\\", "/"), size: Number(info.value.size), mtime });
    }
    return files;
  });

/** How far a pack step has got: unit `done` of `of` (a book), the one being read now. */
export interface PackProgress {
  readonly done: number;
  readonly of: number;
  readonly book: string;
}
