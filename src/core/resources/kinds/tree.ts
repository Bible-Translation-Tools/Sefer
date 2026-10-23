import { Context, Effect, Option, type FileSystem } from "effect";

import { joinPath } from "../../fileSystem/path";
import { Unavailable } from "./handle";

const unavailable = (reason: Unavailable["reason"], description: string): Unavailable =>
  new Unavailable({ reason, description });

export interface ListedFile {
  readonly path: string;
  readonly size: number;
  readonly mtime: number;
}

interface FolderTreeService {
  readonly filesBelow: (directory: string) => Effect.Effect<readonly ListedFile[], Unavailable>;
  readonly read: (
    directory: string,
    paths: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, Uint8Array>, Unavailable>;
}

export class FolderTree extends Context.Service<FolderTree, FolderTreeService>()("FolderTree") {}

export interface UpstreamTree {
  readonly file: (path: string) => Effect.Effect<Uint8Array | undefined, Unavailable>;
  readonly below: (directory: string) => Effect.Effect<readonly string[], Unavailable>;
  readonly read: (
    directory: string,
    paths: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, Uint8Array>, Unavailable>;
}

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

export interface PackProgress {
  readonly done: number;
  readonly of: number;
  readonly book: string;
}
