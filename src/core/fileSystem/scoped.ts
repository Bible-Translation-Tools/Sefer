import { Effect, FileSystem, PlatformError, Stream } from "effect";

import { escapesRoot, isAbsolutePath, joinPath, normalisePath } from "./path";

const MODULE = "ScopedFileSystem";

const refuse = (method: string, path: string): PlatformError.PlatformError =>
  PlatformError.badArgument({
    module: MODULE,
    method,
    description: `"${path}" resolves outside the project root`,
  });

const escapesRootPattern = (pattern: string): boolean =>
  isAbsolutePath(pattern) || pattern.split("/").includes("..");

export const scopedTo = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): FileSystem.FileSystem => {
  const base = normalisePath(root);

  const within = (
    method: string,
    path: string,
  ): Effect.Effect<string, PlatformError.PlatformError> => {
    if (isAbsolutePath(path)) return Effect.fail(refuse(method, path));
    const resolved = joinPath(base, path);
    return escapesRoot(base, resolved)
      ? Effect.fail(refuse(method, path))
      : Effect.succeed(resolved);
  };

  const relative = (absolute: string): string =>
    absolute === base ? "" : absolute.slice(base === "/" ? 1 : base.length + 1);

  const one = <A>(
    method: string,
    path: string,
    run: (resolved: string) => Effect.Effect<A, PlatformError.PlatformError>,
  ): Effect.Effect<A, PlatformError.PlatformError> => Effect.flatMap(within(method, path), run);

  const two = <A>(
    method: string,
    from: string,
    to: string,
    run: (
      fromResolved: string,
      toResolved: string,
    ) => Effect.Effect<A, PlatformError.PlatformError>,
  ): Effect.Effect<A, PlatformError.PlatformError> =>
    Effect.flatMap(within(method, from), (fromResolved) =>
      Effect.flatMap(within(method, to), (toResolved) => run(fromResolved, toResolved)),
    );

  const temporaryIn = (
    method: string,
    directory: string | undefined,
  ): Effect.Effect<string, PlatformError.PlatformError> => within(method, directory ?? "");

  return FileSystem.make({
    access: (path, options) =>
      one("access", path, (resolved) => fileSystem.access(resolved, options)),
    chmod: (path, mode) => one("chmod", path, (resolved) => fileSystem.chmod(resolved, mode)),
    chown: (path, uid, gid) =>
      one("chown", path, (resolved) => fileSystem.chown(resolved, uid, gid)),
    copy: (fromPath, toPath, options) =>
      two("copy", fromPath, toPath, (from, to) => fileSystem.copy(from, to, options)),
    copyFile: (fromPath, toPath) =>
      two("copyFile", fromPath, toPath, (from, to) => fileSystem.copyFile(from, to)),
    glob: (pattern, options) =>
      escapesRootPattern(pattern)
        ? Effect.fail(refuse("glob", pattern))
        : Effect.flatMap(temporaryIn("glob", options?.root), (resolved) =>
            fileSystem.glob(pattern, { ...options, root: resolved }),
          ),
    link: (fromPath, toPath) =>
      two("link", fromPath, toPath, (from, to) => fileSystem.link(from, to)),
    makeDirectory: (path, options) =>
      one("makeDirectory", path, (resolved) => fileSystem.makeDirectory(resolved, options)),
    makeTempDirectory: (options) =>
      Effect.map(
        Effect.flatMap(temporaryIn("makeTempDirectory", options?.directory), (directory) =>
          fileSystem.makeTempDirectory({ ...options, directory }),
        ),
        relative,
      ),
    makeTempDirectoryScoped: (options) =>
      Effect.map(
        Effect.flatMap(temporaryIn("makeTempDirectoryScoped", options?.directory), (directory) =>
          fileSystem.makeTempDirectoryScoped({ ...options, directory }),
        ),
        relative,
      ),
    makeTempFile: (options) =>
      Effect.map(
        Effect.flatMap(temporaryIn("makeTempFile", options?.directory), (directory) =>
          fileSystem.makeTempFile({ ...options, directory }),
        ),
        relative,
      ),
    makeTempFileScoped: (options) =>
      Effect.map(
        Effect.flatMap(temporaryIn("makeTempFileScoped", options?.directory), (directory) =>
          fileSystem.makeTempFileScoped({ ...options, directory }),
        ),
        relative,
      ),
    open: (path, options) =>
      Effect.flatMap(within("open", path), (resolved) => fileSystem.open(resolved, options)),
    readDirectory: (path, options) =>
      one("readDirectory", path, (resolved) => fileSystem.readDirectory(resolved, options)),
    readFile: (path) => one("readFile", path, (resolved) => fileSystem.readFile(resolved)),
    readLink: (path) => one("readLink", path, (resolved) => fileSystem.readLink(resolved)),
    realPath: (path) =>
      Effect.map(
        one("realPath", path, (resolved) => fileSystem.realPath(resolved)),
        relative,
      ),
    remove: (path, options) =>
      one("remove", path, (resolved) => fileSystem.remove(resolved, options)),
    rename: (oldPath, newPath) =>
      two("rename", oldPath, newPath, (from, to) => fileSystem.rename(from, to)),
    stat: (path) => one("stat", path, (resolved) => fileSystem.stat(resolved)),
    symlink: (fromPath, toPath) =>
      two("symlink", fromPath, toPath, (from, to) => fileSystem.symlink(from, to)),
    truncate: (path, length) =>
      one("truncate", path, (resolved) => fileSystem.truncate(resolved, length)),
    utimes: (path, atime, mtime) =>
      one("utimes", path, (resolved) => fileSystem.utimes(resolved, atime, mtime)),
    watch: (path, options) =>
      Stream.unwrap(
        Effect.map(within("watch", path), (resolved) => fileSystem.watch(resolved, options)),
      ),
    writeFile: (path, data, options) =>
      one("writeFile", path, (resolved) => fileSystem.writeFile(resolved, data, options)),
  });
};
