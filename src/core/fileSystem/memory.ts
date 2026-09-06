import { Effect, FileSystem, Layer, Option, PlatformError, Stream } from "effect";

import { joinPath, normalisePath, parentPath } from "./path";

const MODULE = "MemoryFileSystem";

interface FileEntry {
  readonly kind: "file";
  bytes: Uint8Array;
  mode: number;
  atime: number;
  mtime: number;
  readonly birthtime: number;
}

interface DirectoryEntry {
  readonly kind: "directory";
  mode: number;
  atime: number;
  mtime: number;
  readonly birthtime: number;
}

type Entry = FileEntry | DirectoryEntry;

export type MemorySeed = Readonly<Record<string, string | Uint8Array>>;

export interface MemoryFileSystem {
  readonly fileSystem: FileSystem.FileSystem;
  readonly seed: (entries: MemorySeed) => void;
}

const systemFailure = (
  tag: PlatformError.SystemErrorTag,
  method: string,
  path: string,
  description: string,
): Effect.Effect<never, PlatformError.PlatformError> =>
  Effect.fail(
    PlatformError.systemError({
      _tag: tag,
      module: MODULE,
      method,
      pathOrDescriptor: path,
      description,
    }),
  );

const unimplemented = (method: string): PlatformError.PlatformError =>
  PlatformError.badArgument({
    module: MODULE,
    method,
    description: `${method} is not implemented by the in-memory FileSystem`,
  });

const unimplementedEffect = (method: string): Effect.Effect<never, PlatformError.PlatformError> =>
  Effect.fail(unimplemented(method));

const CREATE_EXCLUSIVE = new Set(["wx", "wx+", "ax", "ax+"]);

export const makeMemoryFileSystem = (initial?: MemorySeed): MemoryFileSystem => {
  const store = new Map<string, Entry>();
  let now = 0;
  let unique = 0;

  const stamp = (): number => {
    now += 1;
    return now;
  };

  const directory = (mode: number): DirectoryEntry => {
    const at = stamp();
    return { kind: "directory", mode, atime: at, mtime: at, birthtime: at };
  };

  store.set("", directory(0o755));
  store.set("/", directory(0o755));

  const lookup = (path: string): Entry | undefined => store.get(path);

  const makeDirectoryChain = (path: string): void => {
    if (path === "" || path === "/") return;
    const absolute = path.startsWith("/");
    let current = "";
    for (const part of (absolute ? path.slice(1) : path).split("/")) {
      current = absolute || current !== "" ? `${current}/${part}` : part;
      if (!store.has(current)) store.set(current, directory(0o755));
    }
  };

  const requireDirectory = (
    method: string,
    path: string,
  ): Effect.Effect<void, PlatformError.PlatformError> => {
    const parent = parentPath(path);
    const entry = lookup(parent);
    if (entry === undefined)
      return systemFailure("NotFound", method, parent, "No such file or directory");
    if (entry.kind !== "directory")
      return systemFailure("BadResource", method, parent, "Not a directory");
    return Effect.void;
  };

  const descendants = (path: string): string[] => {
    if (path === "") return [...store.keys()].filter((key) => key !== "" && !key.startsWith("/"));
    const prefix = path === "/" ? "/" : `${path}/`;
    return [...store.keys()].filter((key) => key !== path && key.startsWith(prefix));
  };

  const childNames = (path: string): string[] => {
    const offset = path === "/" ? 1 : path === "" ? 0 : path.length + 1;
    return descendants(path)
      .filter((key) => parentPath(key) === path)
      .map((key) => key.slice(offset))
      .sort();
  };

  const info = (entry: Entry): FileSystem.File.Info => ({
    type: entry.kind === "file" ? "File" : "Directory",
    mtime: Option.some(new Date(entry.mtime)),
    atime: Option.some(new Date(entry.atime)),
    birthtime: Option.some(new Date(entry.birthtime)),
    dev: 0,
    ino: Option.none(),
    mode: entry.mode,
    nlink: Option.none(),
    uid: Option.none(),
    gid: Option.none(),
    rdev: Option.none(),
    size: FileSystem.Size(entry.kind === "file" ? entry.bytes.length : 0),
    blksize: Option.none(),
    blocks: Option.none(),
  });

  const access: FileSystem.FileSystem["access"] = (path) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      return lookup(resolved) === undefined
        ? systemFailure("NotFound", "access", resolved, "No such file or directory")
        : Effect.void;
    });

  const stat: FileSystem.FileSystem["stat"] = (path) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      const entry = lookup(resolved);
      return entry === undefined
        ? systemFailure("NotFound", "stat", resolved, "No such file or directory")
        : Effect.succeed(info(entry));
    });

  const readFile: FileSystem.FileSystem["readFile"] = (path) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      const entry = lookup(resolved);
      if (entry === undefined)
        return systemFailure("NotFound", "readFile", resolved, "No such file or directory");
      if (entry.kind !== "file")
        return systemFailure("BadResource", "readFile", resolved, "Is a directory");
      return Effect.succeed(entry.bytes.slice());
    });

  const writeFile: FileSystem.FileSystem["writeFile"] = (path, data, options) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      const existing = lookup(resolved);
      if (existing !== undefined && existing.kind !== "file")
        return systemFailure("BadResource", "writeFile", resolved, "Is a directory");
      const flag = options?.flag ?? "w";
      if (existing !== undefined && CREATE_EXCLUSIVE.has(flag))
        return systemFailure("AlreadyExists", "writeFile", resolved, "File exists");
      return Effect.map(requireDirectory("writeFile", resolved), () => {
        const bytes =
          flag.startsWith("a") && existing !== undefined
            ? new Uint8Array([...existing.bytes, ...data])
            : data.slice();
        const at = stamp();
        store.set(resolved, {
          kind: "file",
          bytes,
          mode: options?.mode ?? existing?.mode ?? 0o644,
          atime: at,
          mtime: at,
          birthtime: existing?.birthtime ?? at,
        });
      });
    });

  const makeDirectory: FileSystem.FileSystem["makeDirectory"] = (path, options) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      const existing = lookup(resolved);
      if (existing !== undefined) {
        if (options?.recursive === true && existing.kind === "directory") return Effect.void;
        return systemFailure("AlreadyExists", "makeDirectory", resolved, "File exists");
      }
      if (options?.recursive === true) {
        makeDirectoryChain(resolved);
        return Effect.void;
      }
      return Effect.map(requireDirectory("makeDirectory", resolved), () => {
        store.set(resolved, directory(options?.mode ?? 0o755));
      });
    });

  const readDirectory: FileSystem.FileSystem["readDirectory"] = (path, options) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      const entry = lookup(resolved);
      if (entry === undefined)
        return systemFailure("NotFound", "readDirectory", resolved, "No such file or directory");
      if (entry.kind !== "directory")
        return systemFailure("BadResource", "readDirectory", resolved, "Not a directory");
      if (options?.recursive !== true) return Effect.succeed(childNames(resolved));
      const offset = resolved === "/" ? 1 : resolved === "" ? 0 : resolved.length + 1;
      return Effect.succeed(
        descendants(resolved)
          .map((key) => key.slice(offset))
          .sort(),
      );
    });

  const remove: FileSystem.FileSystem["remove"] = (path, options) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      const entry = lookup(resolved);
      if (entry === undefined) {
        return options?.force === true
          ? Effect.void
          : systemFailure("NotFound", "remove", resolved, "No such file or directory");
      }
      if (entry.kind === "directory") {
        const nested = descendants(resolved);
        if (nested.length > 0 && options?.recursive !== true)
          return systemFailure("Unknown", "remove", resolved, "Directory not empty");
        for (const key of nested) store.delete(key);
      }
      store.delete(resolved);
      return Effect.void;
    });

  const rename: FileSystem.FileSystem["rename"] = (oldPath, newPath) =>
    Effect.suspend(() => {
      const from = normalisePath(oldPath);
      const to = normalisePath(newPath);
      const source = lookup(from);
      if (source === undefined)
        return systemFailure("NotFound", "rename", from, "No such file or directory");
      const target = lookup(to);
      if (target !== undefined && target.kind !== source.kind)
        return systemFailure(
          "BadResource",
          "rename",
          to,
          target.kind === "directory" ? "Is a directory" : "Not a directory",
        );
      if (target !== undefined && target.kind === "directory" && descendants(to).length > 0)
        return systemFailure("Unknown", "rename", to, "Directory not empty");
      if (from === to) return Effect.void;
      return Effect.map(requireDirectory("rename", to), () => {
        for (const key of descendants(to)) store.delete(key);
        store.delete(to);
        const sources = descendants(from);
        const moved: Array<readonly [string, Entry]> = [[to, source]];
        for (const key of sources) {
          const entry = store.get(key);
          if (entry !== undefined) moved.push([`${to}${key.slice(from.length)}`, entry]);
        }
        store.delete(from);
        for (const key of sources) store.delete(key);
        for (const [key, entry] of moved) store.set(key, entry);
      });
    });

  const copyFile: FileSystem.FileSystem["copyFile"] = (fromPath, toPath) =>
    Effect.flatMap(readFile(fromPath), (bytes) => writeFile(toPath, bytes));

  const copy: FileSystem.FileSystem["copy"] = (fromPath, toPath) =>
    Effect.suspend(() => {
      const from = normalisePath(fromPath);
      const to = normalisePath(toPath);
      const source = lookup(from);
      if (source === undefined)
        return systemFailure("NotFound", "copy", from, "No such file or directory");
      if (source.kind === "file") return copyFile(from, to);
      makeDirectoryChain(to);
      for (const key of descendants(from)) {
        const entry = store.get(key);
        if (entry === undefined) continue;
        const destination = `${to}${key.slice(from.length)}`;
        makeDirectoryChain(parentPath(destination));
        store.set(
          destination,
          entry.kind === "file" ? { ...entry, bytes: entry.bytes.slice() } : { ...entry },
        );
      }
      return Effect.void;
    });

  const temporaryName = (prefix: string | undefined): string => {
    unique += 1;
    return `${prefix ?? ""}${unique.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  };

  const makeTempDirectory: FileSystem.FileSystem["makeTempDirectory"] = (options) =>
    Effect.suspend(() => {
      const base = normalisePath(options?.directory ?? "/tmp");
      makeDirectoryChain(base);
      const created = joinPath(base, temporaryName(options?.prefix));
      store.set(created, directory(0o700));
      return Effect.succeed(created);
    });

  const makeTempFile: FileSystem.FileSystem["makeTempFile"] = (options) =>
    Effect.flatMap(makeTempDirectory({ directory: options?.directory }), (created) => {
      const file = joinPath(created, `${temporaryName(options?.prefix)}${options?.suffix ?? ""}`);
      return Effect.as(writeFile(file, new Uint8Array()), file);
    });

  const makeTempDirectoryScoped: FileSystem.FileSystem["makeTempDirectoryScoped"] = (options) =>
    Effect.acquireRelease(makeTempDirectory(options), (created) =>
      Effect.ignore(remove(created, { recursive: true, force: true })),
    );

  const makeTempFileScoped: FileSystem.FileSystem["makeTempFileScoped"] = (options) =>
    Effect.acquireRelease(makeTempFile(options), (created) =>
      Effect.ignore(remove(created, { force: true })),
    );

  const realPath: FileSystem.FileSystem["realPath"] = (path) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      return lookup(resolved) === undefined
        ? systemFailure("NotFound", "realPath", resolved, "No such file or directory")
        : Effect.succeed(resolved);
    });

  const truncate: FileSystem.FileSystem["truncate"] = (path, length) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      const entry = lookup(resolved);
      if (entry === undefined)
        return systemFailure("NotFound", "truncate", resolved, "No such file or directory");
      if (entry.kind !== "file")
        return systemFailure("BadResource", "truncate", resolved, "Is a directory");
      const size = Number(FileSystem.Size(length ?? 0));
      const bytes = new Uint8Array(size);
      bytes.set(entry.bytes.slice(0, size));
      entry.bytes = bytes;
      entry.mtime = stamp();
      return Effect.void;
    });

  const chmod: FileSystem.FileSystem["chmod"] = (path, mode) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      const entry = lookup(resolved);
      if (entry === undefined)
        return systemFailure("NotFound", "chmod", resolved, "No such file or directory");
      entry.mode = mode;
      return Effect.void;
    });

  const utimes: FileSystem.FileSystem["utimes"] = (path, atime, mtime) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      const entry = lookup(resolved);
      if (entry === undefined)
        return systemFailure("NotFound", "utimes", resolved, "No such file or directory");
      entry.atime = atime instanceof Date ? atime.getTime() : atime;
      entry.mtime = mtime instanceof Date ? mtime.getTime() : mtime;
      return Effect.void;
    });

  const fileSystem = FileSystem.make({
    access,
    chmod,
    chown: () => unimplementedEffect("chown"),
    copy,
    copyFile,
    glob: () => unimplementedEffect("glob"),
    link: () => unimplementedEffect("link"),
    makeDirectory,
    makeTempDirectory,
    makeTempDirectoryScoped,
    makeTempFile,
    makeTempFileScoped,
    open: () => unimplementedEffect("open"),
    readDirectory,
    readFile,
    readLink: () => unimplementedEffect("readLink"),
    realPath,
    remove,
    rename,
    stat,
    symlink: () => unimplementedEffect("symlink"),
    truncate,
    utimes,
    watch: () => Stream.fail(unimplemented("watch")),
    writeFile,
  });

  const seed = (entries: MemorySeed): void => {
    const encoder = new TextEncoder();
    for (const [path, content] of Object.entries(entries)) {
      const resolved = normalisePath(path);
      makeDirectoryChain(parentPath(resolved));
      const at = stamp();
      store.set(resolved, {
        kind: "file",
        bytes: typeof content === "string" ? encoder.encode(content) : content.slice(),
        mode: 0o644,
        atime: at,
        mtime: at,
        birthtime: at,
      });
    }
  };

  if (initial !== undefined) seed(initial);

  return { fileSystem, seed };
};

export const MemoryFileSystemLive = (initial?: MemorySeed): Layer.Layer<FileSystem.FileSystem> =>
  Layer.sync(FileSystem.FileSystem, () => makeMemoryFileSystem(initial).fileSystem);
