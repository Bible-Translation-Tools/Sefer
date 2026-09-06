import type { Effect as EffectType, FileSystem } from "effect";
import { Effect, Option, PlatformError, Result } from "effect";

export interface NodeStats {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly isFile: () => boolean;
  readonly isDirectory: () => boolean;
  readonly isSymbolicLink: () => boolean;
}

export type ReadFileOptions = string | { readonly encoding?: string | null } | undefined;

export interface IsomorphicFs {
  readonly readFile: (path: string, options?: ReadFileOptions) => Promise<Uint8Array | string>;
  readonly writeFile: (
    path: string,
    data: Uint8Array | string,
    options?: ReadFileOptions,
  ) => Promise<void>;
  readonly unlink: (path: string) => Promise<void>;
  readonly readdir: (path: string) => Promise<string[]>;
  readonly mkdir: (path: string) => Promise<void>;
  readonly rmdir: (path: string) => Promise<void>;
  readonly stat: (path: string) => Promise<NodeStats>;
  readonly lstat: (path: string) => Promise<NodeStats>;
  readonly rename: (fromPath: string, toPath: string) => Promise<void>;
  readonly readlink: (path: string) => Promise<string>;
  readonly symlink: (target: string, path: string) => Promise<void>;
}

export type RunEffect = <A>(
  effect: EffectType.Effect<A, PlatformError.PlatformError>,
) => Promise<A>;

const FILE_TYPE_BITS = 0o100000;
const DIRECTORY_TYPE_BITS = 0o040000;
const PERMISSION_BITS = 0o7777;

const codeFor = (error: PlatformError.PlatformError): string => {
  const reason = error.reason;
  const description = reason.description ?? "";
  if (description.includes("Not a directory")) return "ENOTDIR";
  if (description.includes("Is a directory")) return "EISDIR";
  if (reason._tag === "BadArgument") return "EINVAL";
  if (reason._tag === "NotFound") return "ENOENT";
  if (reason._tag === "AlreadyExists") return "EEXIST";
  return "EIO";
};

const nodeError = (error: PlatformError.PlatformError, path: string): Error => {
  const code = codeFor(error);
  const failure = new Error(`${code}: ${error.reason.description ?? error.message}, '${path}'`);
  return Object.assign(failure, { code, path, errno: -1, syscall: error.reason.method });
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const wantsText = (options: ReadFileOptions): boolean => {
  if (typeof options === "string") return options !== "buffer";
  const encoding = options?.encoding;
  return typeof encoding === "string" && encoding !== "buffer";
};

const millisecondsOf = (value: Option.Option<Date>): number =>
  Option.isSome(value) ? value.value.getTime() : 0;

const statsOf = (info: FileSystem.File.Info): NodeStats => {
  const directory = info.type === "Directory";
  const link = info.type === "SymbolicLink";
  const modified = millisecondsOf(info.mtime);
  return {
    dev: info.dev,
    ino: Option.isSome(info.ino) ? Number(info.ino.value) : 0,
    mode: (info.mode & PERMISSION_BITS) | (directory ? DIRECTORY_TYPE_BITS : FILE_TYPE_BITS),
    uid: Option.isSome(info.uid) ? info.uid.value : 0,
    gid: Option.isSome(info.gid) ? info.gid.value : 0,
    size: Number(info.size),
    mtimeMs: modified,
    ctimeMs: modified,
    isFile: () => !directory && !link,
    isDirectory: () => directory,
    isSymbolicLink: () => link,
  };
};

export const nodeFsView = (fileSystem: FileSystem.FileSystem, run: RunEffect): IsomorphicFs => {
  const attempt = async <A>(
    path: string,
    effect: EffectType.Effect<A, PlatformError.PlatformError>,
  ): Promise<A> => {
    const result = await run(Effect.result(effect));
    if (Result.isFailure(result)) throw nodeError(result.failure, path);
    return result.success;
  };

  return {
    readFile: async (path, options) => {
      const bytes = await attempt(path, fileSystem.readFile(path));
      return wantsText(options) ? decoder.decode(bytes) : bytes;
    },
    writeFile: async (path, data) => {
      const bytes = typeof data === "string" ? encoder.encode(data) : data;
      await attempt(path, fileSystem.writeFile(path, bytes));
    },
    unlink: (path) => attempt(path, fileSystem.remove(path)),
    readdir: (path) =>
      attempt(
        path,
        Effect.map(fileSystem.readDirectory(path), (names) => [...names]),
      ),
    mkdir: (path) => attempt(path, fileSystem.makeDirectory(path)),
    rmdir: (path) => attempt(path, fileSystem.remove(path)),
    stat: (path) => attempt(path, Effect.map(fileSystem.stat(path), statsOf)),
    lstat: (path) => attempt(path, Effect.map(fileSystem.stat(path), statsOf)),
    rename: (fromPath, toPath) => attempt(fromPath, fileSystem.rename(fromPath, toPath)),
    readlink: (path) => attempt(path, fileSystem.readLink(path)),
    symlink: (target, path) => attempt(path, fileSystem.symlink(target, path)),
  };
};
