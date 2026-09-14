import { Effect, FileSystem, Layer, Option, PlatformError, Stream } from "effect";

import { joinPath, normalisePath } from "../../core/fileSystem/path";

const MODULE = "OpfsFileSystem";

type EntryKind = "file" | "directory";

declare global {
  interface FileSystemHandle {
    readonly move?: (parent: FileSystemDirectoryHandle, name: string) => Promise<void>;
  }
}

const CREATE_EXCLUSIVE = new Set(["wx", "wx+", "ax", "ax+"]);

const systemError = (
  tag: PlatformError.SystemErrorTag,
  method: string,
  path: string,
  description: string,
): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: tag,
    module: MODULE,
    method,
    pathOrDescriptor: path,
    description,
  });

const notFound = (method: string, path: string): PlatformError.PlatformError =>
  systemError("NotFound", method, path, "No such file or directory");

const unimplemented = (method: string): PlatformError.PlatformError =>
  PlatformError.badArgument({
    module: MODULE,
    method,
    description: `${method} is not implemented by the OPFS FileSystem`,
  });

const unimplementedEffect = (method: string): Effect.Effect<never, PlatformError.PlatformError> =>
  Effect.fail(unimplemented(method));

const isDomError = (cause: unknown, name: string): boolean =>
  cause instanceof DOMException && cause.name === name;

const unexpected = (method: string, path: string, cause: unknown): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: "Unknown",
    module: MODULE,
    method,
    pathOrDescriptor: path,
    description: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

const segmentsOf = (path: string): string[] =>
  normalisePath(path)
    .split("/")
    .filter((segment) => segment !== "");

const bytesOf = async (handle: FileSystemFileHandle): Promise<Uint8Array> =>
  new Uint8Array(await (await handle.getFile()).arrayBuffer());

export const makeOpfsFileSystem = (): FileSystem.FileSystem => {
  let cachedRoot: Promise<FileSystemDirectoryHandle> | undefined;
  let unique = 0;

  const root = (): Promise<FileSystemDirectoryHandle> => {
    cachedRoot ??= navigator.storage.getDirectory();
    return cachedRoot;
  };

  const attempt = <A>(
    method: string,
    path: string,
    run: (from: FileSystemDirectoryHandle) => Promise<A>,
  ): Effect.Effect<A, PlatformError.PlatformError> =>
    Effect.tryPromise({
      try: async () => run(await root()),
      catch: (cause) =>
        cause instanceof PlatformError.PlatformError ? cause : unexpected(method, path, cause),
    });

  const directoryAt = async (
    from: FileSystemDirectoryHandle,
    segments: readonly string[],
    method: string,
    path: string,
  ): Promise<FileSystemDirectoryHandle> => {
    let current = from;
    for (const segment of segments) {
      try {
        current = await current.getDirectoryHandle(segment);
      } catch (cause) {
        if (isDomError(cause, "NotFoundError")) throw notFound(method, path);
        if (isDomError(cause, "TypeMismatchError"))
          throw systemError("BadResource", method, path, "Not a directory");
        throw unexpected(method, path, cause);
      }
    }
    return current;
  };

  const directoryChain = async (
    from: FileSystemDirectoryHandle,
    segments: readonly string[],
    method: string,
    path: string,
  ): Promise<FileSystemDirectoryHandle> => {
    let current = from;
    for (const segment of segments) {
      try {
        current = await current.getDirectoryHandle(segment, { create: true });
      } catch (cause) {
        if (isDomError(cause, "TypeMismatchError"))
          throw systemError("BadResource", method, path, "Not a directory");
        throw unexpected(method, path, cause);
      }
    }
    return current;
  };

  const childKind = async (
    parent: FileSystemDirectoryHandle,
    name: string,
  ): Promise<EntryKind | undefined> => {
    const file = await parent.getFileHandle(name).then(
      () => "file" as const,
      () => undefined,
    );
    if (file !== undefined) return file;
    return parent.getDirectoryHandle(name).then(
      () => "directory" as const,
      () => undefined,
    );
  };

  const kindOf = async (
    from: FileSystemDirectoryHandle,
    path: string,
  ): Promise<EntryKind | undefined> => {
    const segments = segmentsOf(path);
    const name = segments.at(-1);
    if (name === undefined) return "directory";
    let parent: FileSystemDirectoryHandle;
    try {
      parent = await directoryAt(from, segments.slice(0, -1), "stat", path);
    } catch {
      return undefined;
    }
    return childKind(parent, name);
  };

  const fileAt = async (
    from: FileSystemDirectoryHandle,
    path: string,
    method: string,
  ): Promise<FileSystemFileHandle> => {
    const segments = segmentsOf(path);
    const name = segments.at(-1);
    if (name === undefined) throw systemError("BadResource", method, path, "Is a directory");
    const parent = await directoryAt(from, segments.slice(0, -1), method, path);
    try {
      return await parent.getFileHandle(name);
    } catch (cause) {
      if (isDomError(cause, "NotFoundError")) throw notFound(method, path);
      if (isDomError(cause, "TypeMismatchError"))
        throw systemError("BadResource", method, path, "Is a directory");
      throw unexpected(method, path, cause);
    }
  };

  const namesIn = async (handle: FileSystemDirectoryHandle): Promise<string[]> => {
    const names: string[] = [];
    for await (const name of handle.keys()) names.push(name);
    return names.sort();
  };

  const descendantNames = async (
    handle: FileSystemDirectoryHandle,
    prefix: string,
  ): Promise<string[]> => {
    const found: string[] = [];
    for (const name of await namesIn(handle)) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      found.push(path);
      const kind = await childKind(handle, name);
      if (kind === "directory")
        found.push(...(await descendantNames(await handle.getDirectoryHandle(name), path)));
    }
    return found.sort();
  };

  const info = (kind: EntryKind, size: number, modified: number): FileSystem.File.Info => ({
    type: kind === "file" ? "File" : "Directory",
    mtime: Option.some(new Date(modified)),
    atime: Option.some(new Date(modified)),
    birthtime: Option.some(new Date(modified)),
    dev: 0,
    ino: Option.none(),
    mode: kind === "file" ? 0o644 : 0o755,
    nlink: Option.none(),
    uid: Option.none(),
    gid: Option.none(),
    rdev: Option.none(),
    size: FileSystem.Size(size),
    blksize: Option.none(),
    blocks: Option.none(),
  });

  const writeBytes = async (handle: FileSystemFileHandle, data: Uint8Array): Promise<void> => {
    // SAFETY: OPFS never hands us a SharedArrayBuffer-backed view, so the buffer is an ArrayBuffer.
    const chunk = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    const writable = await handle.createWritable();
    await writable.write(chunk);
    await writable.close();
  };

  const access: FileSystem.FileSystem["access"] = (path) =>
    attempt("access", path, async (from) => {
      if ((await kindOf(from, path)) === undefined) throw notFound("access", path);
    });

  const stat: FileSystem.FileSystem["stat"] = (path) =>
    attempt("stat", path, async (from) => {
      const segments = segmentsOf(path);
      const name = segments.at(-1);
      if (name === undefined) return info("directory", 0, 0);
      const parent = await directoryAt(from, segments.slice(0, -1), "stat", path);
      try {
        const file = await (await parent.getFileHandle(name)).getFile();
        return info("file", file.size, file.lastModified);
      } catch (cause) {
        if (!isDomError(cause, "NotFoundError") && !isDomError(cause, "TypeMismatchError"))
          throw unexpected("stat", path, cause);
      }
      try {
        await parent.getDirectoryHandle(name);
        return info("directory", 0, 0);
      } catch (cause) {
        if (isDomError(cause, "NotFoundError")) throw notFound("stat", path);
        throw unexpected("stat", path, cause);
      }
    });

  const readFile: FileSystem.FileSystem["readFile"] = (path) =>
    attempt("readFile", path, async (from) => bytesOf(await fileAt(from, path, "readFile")));

  const writeFile: FileSystem.FileSystem["writeFile"] = (path, data, options) =>
    attempt("writeFile", path, async (from) => {
      const segments = segmentsOf(path);
      const name = segments.at(-1);
      if (name === undefined) throw systemError("BadResource", "writeFile", path, "Is a directory");
      const parent = await directoryAt(from, segments.slice(0, -1), "writeFile", path);
      const flag = options?.flag ?? "w";
      let existing: FileSystemFileHandle | undefined;
      try {
        existing = await parent.getFileHandle(name);
      } catch (cause) {
        if (isDomError(cause, "TypeMismatchError"))
          throw systemError("BadResource", "writeFile", path, "Is a directory");
        if (!isDomError(cause, "NotFoundError")) throw unexpected("writeFile", path, cause);
      }
      if (existing !== undefined && CREATE_EXCLUSIVE.has(flag))
        throw systemError("AlreadyExists", "writeFile", path, "File exists");
      const previous =
        flag.startsWith("a") && existing !== undefined ? await bytesOf(existing) : undefined;
      const bytes = previous === undefined ? data : new Uint8Array([...previous, ...data]);
      const handle = existing ?? (await parent.getFileHandle(name, { create: true }));
      await writeBytes(handle, bytes);
    });

  const makeDirectory: FileSystem.FileSystem["makeDirectory"] = (path, options) =>
    attempt("makeDirectory", path, async (from) => {
      const segments = segmentsOf(path);
      const recursive = options?.recursive === true;
      const name = segments.at(-1);
      if (name === undefined) {
        if (recursive) return;
        throw systemError("AlreadyExists", "makeDirectory", path, "File exists");
      }
      if (recursive) {
        await directoryChain(from, segments, "makeDirectory", path);
        return;
      }
      const parent = await directoryAt(from, segments.slice(0, -1), "makeDirectory", path);
      if ((await childKind(parent, name)) !== undefined)
        throw systemError("AlreadyExists", "makeDirectory", path, "File exists");
      await parent.getDirectoryHandle(name, { create: true });
    });

  const readDirectory: FileSystem.FileSystem["readDirectory"] = (path, options) =>
    attempt("readDirectory", path, async (from) => {
      const handle = await directoryAt(from, segmentsOf(path), "readDirectory", path);
      return options?.recursive === true ? descendantNames(handle, "") : namesIn(handle);
    });

  const remove: FileSystem.FileSystem["remove"] = (path, options) =>
    attempt("remove", path, async (from) => {
      const force = options?.force === true;
      const segments = segmentsOf(path);
      const name = segments.at(-1);
      if (name === undefined) throw systemError("BadResource", "remove", path, "Is a directory");
      let parent: FileSystemDirectoryHandle;
      try {
        parent = await directoryAt(from, segments.slice(0, -1), "remove", path);
      } catch (cause) {
        if (force) return;
        throw cause;
      }
      try {
        await parent.removeEntry(name, { recursive: options?.recursive === true });
      } catch (cause) {
        if (isDomError(cause, "NotFoundError")) {
          if (force) return;
          throw notFound("remove", path);
        }
        if (isDomError(cause, "InvalidModificationError"))
          throw systemError("Unknown", "remove", path, "Directory not empty");
        throw unexpected("remove", path, cause);
      }
    });

  const rename: FileSystem.FileSystem["rename"] = (oldPath, newPath) =>
    attempt("rename", oldPath, async (from) => {
      const source = normalisePath(oldPath);
      const target = normalisePath(newPath);
      const sourceKind = await kindOf(from, source);
      if (sourceKind === undefined) throw notFound("rename", source);
      if (source === target) return;
      const targetKind = await kindOf(from, target);
      if (targetKind !== undefined && targetKind !== sourceKind)
        throw systemError(
          "BadResource",
          "rename",
          target,
          targetKind === "directory" ? "Is a directory" : "Not a directory",
        );
      const targetSegments = segmentsOf(target);
      const targetName = targetSegments.at(-1);
      if (targetName === undefined)
        throw systemError("BadResource", "rename", target, "Is a directory");
      const targetParent = await directoryAt(from, targetSegments.slice(0, -1), "rename", target);
      if (targetKind === "directory") {
        const existing = await targetParent.getDirectoryHandle(targetName);
        if ((await namesIn(existing)).length > 0)
          throw systemError("Unknown", "rename", target, "Directory not empty");
        await targetParent.removeEntry(targetName);
      }
      const sourceSegments = segmentsOf(source);
      const sourceName = sourceSegments.at(-1);
      if (sourceName === undefined)
        throw systemError("BadResource", "rename", source, "Is a directory");
      const sourceParent = await directoryAt(from, sourceSegments.slice(0, -1), "rename", source);
      if (sourceKind === "directory") {
        const handle = await sourceParent.getDirectoryHandle(sourceName);
        if (typeof handle.move !== "function") throw unimplemented("rename");
        await handle.move(targetParent, targetName);
        return;
      }
      const handle = await sourceParent.getFileHandle(sourceName);
      if (typeof handle.move === "function") {
        await handle.move(targetParent, targetName);
        return;
      }
      await writeBytes(
        await targetParent.getFileHandle(targetName, { create: true }),
        await bytesOf(handle),
      );
      await sourceParent.removeEntry(sourceName);
    });

  const copyFile: FileSystem.FileSystem["copyFile"] = (fromPath, toPath) =>
    Effect.flatMap(readFile(fromPath), (bytes) => writeFile(toPath, bytes));

  /**
   * Copy, recursively, because OPFS has no copy primitive and the import
   * pipeline copies whole project trees. A file is `copyFile`; a directory is
   * its entries, one at a time, into a directory made on demand. Left
   * unimplemented this refused every import in a browser.
   */
  const copy: FileSystem.FileSystem["copy"] = (fromPath, toPath) =>
    Effect.gen(function* () {
      const info = yield* stat(fromPath);
      // `overwrite` is not honoured: writing a file here always replaces it,
      // which is what every caller in Sefer asks for anyway.
      if (info.type !== "Directory") return yield* copyFile(fromPath, toPath);
      yield* makeDirectory(toPath, { recursive: true });
      const entries = yield* readDirectory(fromPath);
      for (const entry of entries) yield* copy(joinPath(fromPath, entry), joinPath(toPath, entry));
    });

  const makeTempDirectory: FileSystem.FileSystem["makeTempDirectory"] = (options) =>
    attempt("makeTempDirectory", options?.directory ?? "/tmp", async (from) => {
      const base = normalisePath(options?.directory ?? "/tmp");
      unique += 1;
      const created = joinPath(
        base,
        `${options?.prefix ?? ""}${unique.toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      );
      await directoryChain(from, segmentsOf(created), "makeTempDirectory", created);
      return created;
    });

  const makeTempDirectoryScoped: FileSystem.FileSystem["makeTempDirectoryScoped"] = (options) =>
    Effect.acquireRelease(makeTempDirectory(options), (created) =>
      Effect.ignore(remove(created, { recursive: true, force: true })),
    );

  return FileSystem.make({
    access,
    chmod: () => unimplementedEffect("chmod"),
    chown: () => unimplementedEffect("chown"),
    copy,
    copyFile,
    glob: () => unimplementedEffect("glob"),
    link: () => unimplementedEffect("link"),
    makeDirectory,
    makeTempDirectory,
    makeTempDirectoryScoped,
    makeTempFile: () => unimplementedEffect("makeTempFile"),
    makeTempFileScoped: () => unimplementedEffect("makeTempFileScoped"),
    open: () => unimplementedEffect("open"),
    readDirectory,
    readFile,
    readLink: () => unimplementedEffect("readLink"),
    realPath: (path) => Effect.as(access(path), normalisePath(path)),
    remove,
    rename,
    stat,
    symlink: () => unimplementedEffect("symlink"),
    truncate: () => unimplementedEffect("truncate"),
    utimes: () => unimplementedEffect("utimes"),
    watch: () => Stream.fail(unimplemented("watch")),
    writeFile,
  });
};

export const OpfsFileSystemLive: Layer.Layer<FileSystem.FileSystem> = Layer.sync(
  FileSystem.FileSystem,
  makeOpfsFileSystem,
);
