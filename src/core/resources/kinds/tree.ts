/**
 * An upstream resource's files, wherever they are while Sefer reads them
 * once: today a folder on a `FileSystem` (desktop's clone, the Web's clone
 * staged in memory, a picked folder); a zip's entries would be another. What
 * a kind's pack step reads (`KindRow.pack`): TN's chunk files today, TW's
 * articles and TQ's questions the same way.
 */

import { Context, Effect, Option, type FileSystem } from "effect";

import { joinPath } from "../../fileSystem/path";
import { Unavailable } from "./handle";

const unavailable = (reason: Unavailable["reason"], description: string): Unavailable =>
  new Unavailable({ reason, description });

/** One file below a folder: its path relative to it, `/`-separated, its size and mtime (ms). */
export interface ListedFile {
  readonly path: string;
  readonly size: number;
  readonly mtime: number;
}

/**
 * A host's fast path to a folder's files, when it has one.
 *
 * Through the `FileSystem` port a listing with sizes is a `stat` per file and
 * a read is a call per file, which costs nothing on the Web's in-memory clone
 * and a lot on desktop, where every call crosses IPC: en_tn's Psalms is about
 * 2,600 files, and with the display awake its freshness check took 12 s and
 * its first read 40 s (2026-10-13). A host that can answer a whole folder in
 * one call provides this, and `filesBelow` and `treeInFolder` use it; without
 * it they walk the port as before. Desktop answers it with two Rust commands
 * (`src-tauri/src/tree.rs`).
 */
interface FolderTreeService {
  /** Every file below `directory`, relative to it, sorted. Empty when there is no such folder. */
  readonly filesBelow: (directory: string) => Effect.Effect<readonly ListedFile[], Unavailable>;
  /** The bytes of `paths` below `directory`; fails naming the first that cannot be read. */
  readonly read: (
    directory: string,
    paths: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, Uint8Array>, Unavailable>;
}

export class FolderTree extends Context.Service<FolderTree, FolderTreeService>()("FolderTree") {}

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
      const fast = yield* Effect.serviceOption(FolderTree);
      if (Option.isSome(fast)) return yield* fast.value.read(joinPath(root, directory), paths);
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

/**
 * Every file below `directory`, relative to it, sorted, with its size and
 * modification time: in one call where the host provides `FolderTree`, a
 * `stat` per file otherwise (and if that call fails).
 */
export const filesBelow = (
  fileSystem: FileSystem.FileSystem,
  directory: string,
): Effect.Effect<readonly ListedFile[]> =>
  Effect.gen(function* () {
    const fast = yield* Effect.serviceOption(FolderTree);
    if (Option.isSome(fast)) {
      const listed = yield* Effect.option(fast.value.filesBelow(directory));
      if (Option.isSome(listed)) return listed.value;
    }
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
