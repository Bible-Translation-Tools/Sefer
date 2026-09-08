/**
 * The desktop host's `FileSystem`: `@tauri-apps/plugin-fs` behind the Effect
 * port, so every module above it — Save, Recovery, Library, Project — reads
 * and writes real files without naming Tauri.
 *
 * Two things make this layer different from the OPFS one it sits beside:
 *
 *   1. Paths are real absolute OS paths, so a project can live in
 *      `~/Documents` rather than only in a sandbox Sefer owns. What Sefer may
 *      touch is decided once, declaratively, in
 *      `src-tauri/capabilities/default.json` — a path outside that scope comes
 *      back as `PermissionDenied` rather than as a silent empty read.
 *   2. `rename` genuinely replaces the destination, which is what makes
 *      `writeFileAtomic` atomic on desktop (see documentation/architecture/storage.md).
 *
 * `watch` is real here too, so `HostInfo.capabilities().fsWatch` is true and
 * the project module can notice a book edited by another program.
 *
 * Methods no Sefer flow uses fail with a `PlatformError` naming the method,
 * the same convention `memory.ts` and the OPFS layer follow: an unimplemented
 * corner of the port must be loud, never a quiet success.
 */
import { tempDir } from "@tauri-apps/api/path";
import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readFile,
  remove,
  rename,
  stat,
  watch,
  writeFile,
  type FileInfo,
  type WatchEvent as TauriWatchEvent,
} from "@tauri-apps/plugin-fs";
import { Effect, FileSystem, Layer, Option, PlatformError, Queue, Stream } from "effect";

import { joinPath, normalisePath } from "../../core/fileSystem/path";

const MODULE = "TauriFileSystem";

const systemError = (
  tag: PlatformError.SystemErrorTag,
  method: string,
  path: string,
  description: string,
  cause?: unknown,
): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: tag,
    module: MODULE,
    method,
    pathOrDescriptor: path,
    description,
    cause,
  });

const unimplemented = (method: string): PlatformError.PlatformError =>
  PlatformError.badArgument({
    module: MODULE,
    method,
    description: `${method} is not implemented by the Tauri FileSystem`,
  });

const unimplementedEffect = (method: string): Effect.Effect<never, PlatformError.PlatformError> =>
  Effect.fail(unimplemented(method));

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * The plugin rejects with the Rust error's `Display` text, so the only signal
 * available is the message. `os error <n>` is the reliable part of it on every
 * platform Tauri supports; the word-matching below is the fallback for the
 * plugin's own errors (scope refusals) which carry no errno.
 */
const classify = (message: string): PlatformError.SystemErrorTag => {
  const text = message.toLowerCase();
  if (text.includes("os error 2") || text.includes("os error 3") || text.includes("not found")) {
    return "NotFound";
  }
  if (text.includes("os error 17") || text.includes("already exists")) return "AlreadyExists";
  if (
    text.includes("forbidden path") ||
    text.includes("not allowed") ||
    text.includes("os error 13") ||
    text.includes("permission denied")
  ) {
    return "PermissionDenied";
  }
  if (text.includes("os error 20") || text.includes("os error 21") || text.includes("directory")) {
    return "BadResource";
  }
  return "Unknown";
};

/** Every call into the plugin funnels through here, so no rejection escapes. */
const attempt = <A>(
  method: string,
  path: string,
  run: () => Promise<A>,
): Effect.Effect<A, PlatformError.PlatformError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => {
      const message = messageOf(cause);
      return systemError(classify(message), method, path, message, cause);
    },
  });

const infoOf = (entry: FileInfo): FileSystem.File.Info => ({
  type: entry.isSymlink ? "SymbolicLink" : entry.isDirectory ? "Directory" : "File",
  mtime: Option.fromNullOr(entry.mtime),
  atime: Option.fromNullOr(entry.atime),
  birthtime: Option.fromNullOr(entry.birthtime),
  dev: 0,
  ino: Option.none(),
  // The plugin reports a readonly flag, not a mode. Reporting the two modes
  // Sefer can actually distinguish is more useful than reporting zero.
  mode: entry.readonly ? 0o444 : 0o644,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: FileSystem.Size(entry.size),
  blksize: Option.none(),
  blocks: Option.none(),
});

/**
 * The plugin's event kind is a tagged union of notify's kinds; the port names
 * three. `access` events are dropped (a read is not a change) and anything
 * unrecognised is reported as an update, because a watcher that stays silent
 * about a change it did not understand is the failure mode that costs data.
 */
const watchEventsOf = (event: TauriWatchEvent): FileSystem.WatchEvent[] => {
  const kind = event.type;
  if (kind === "any" || kind === "other") {
    return event.paths.map((path): FileSystem.WatchEvent => ({ _tag: "Update", path }));
  }
  if ("access" in kind) return [];
  const tag: FileSystem.WatchEvent["_tag"] =
    "create" in kind ? "Create" : "remove" in kind ? "Remove" : "Update";
  return event.paths.map((path) => ({ _tag: tag, path }));
};

/** The flags that mean "create, but refuse if it is already there". */
const CREATE_EXCLUSIVE = new Set(["wx", "wx+", "ax", "ax+"]);

export const makeTauriFileSystem = (): FileSystem.FileSystem => {
  let unique = 0;

  const access: FileSystem.FileSystem["access"] = (path) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      return Effect.flatMap(
        attempt("access", resolved, () => exists(resolved)),
        (present) =>
          present
            ? Effect.void
            : Effect.fail(systemError("NotFound", "access", resolved, "No such file or directory")),
      );
    });

  const readDirectory: FileSystem.FileSystem["readDirectory"] = (path, options) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      if (options?.recursive !== true) {
        return Effect.map(
          attempt("readDirectory", resolved, () => readDir(resolved)),
          (entries) => entries.map((entry) => entry.name).sort(),
        );
      }
      // The plugin's readDir is one level deep; the port's recursive form
      // yields every descendant, relative to the directory asked for.
      const walk = (
        directory: string,
        prefix: string,
      ): Effect.Effect<readonly string[], PlatformError.PlatformError> =>
        Effect.flatMap(
          attempt("readDirectory", directory, () => readDir(directory)),
          (entries) =>
            Effect.map(
              Effect.forEach(entries, (entry) => {
                const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
                return entry.isDirectory
                  ? Effect.map(walk(joinPath(directory, entry.name), relative), (nested) => [
                      relative,
                      ...nested,
                    ])
                  : Effect.succeed([relative]);
              }),
              (nested) => nested.flat(),
            ),
        );
      return Effect.map(walk(resolved, ""), (found) => [...found].sort());
    });

  /**
   * The plugin has `append` and `create` but no exclusive-create, so the `wx`
   * family is honoured with a check first. Racy in principle; the port's only
   * user of it is a "do not clobber" guard where losing the race means two
   * writers were fighting over one path, which is a bug upstream either way.
   */
  const writeFileAt: FileSystem.FileSystem["writeFile"] = (path, data, options) =>
    Effect.suspend(() => {
      const resolved = normalisePath(path);
      const write = attempt("writeFile", resolved, () =>
        writeFile(resolved, data, {
          append: options?.flag?.startsWith("a") ?? false,
          create: true,
        }),
      );
      if (options?.flag === undefined || !CREATE_EXCLUSIVE.has(options.flag)) return write;
      return Effect.flatMap(
        attempt("writeFile", resolved, () => exists(resolved)),
        (present) =>
          present
            ? Effect.fail(systemError("AlreadyExists", "writeFile", resolved, "File exists"))
            : write,
      );
    });

  /**
   * Temporary files live under the OS temp directory, which is why `$TEMP` is
   * in the fs capability scope. A unique name rather than a mkstemp: the
   * plugin exposes no atomic create, and this is the same bargain the OPFS and
   * in-memory layers make.
   */
  const temporaryName = (prefix: string | undefined): string => {
    unique += 1;
    return `${prefix ?? ""}${unique.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  };

  const makeTempDirectory: FileSystem.FileSystem["makeTempDirectory"] = (options) =>
    Effect.gen(function* () {
      const base =
        options?.directory === undefined
          ? yield* attempt("makeTempDirectory", "$TEMP", () => tempDir())
          : options.directory;
      const created = joinPath(normalisePath(base), temporaryName(options?.prefix));
      yield* attempt("makeTempDirectory", created, () => mkdir(created, { recursive: true }));
      return created;
    });

  const removeQuietly = (path: string): Effect.Effect<void> =>
    Effect.ignore(attempt("remove", path, () => remove(path, { recursive: true })));

  const makeTempFile: FileSystem.FileSystem["makeTempFile"] = (options) =>
    Effect.gen(function* () {
      const directory = yield* makeTempDirectory(
        options?.directory === undefined ? undefined : { directory: options.directory },
      );
      const file = joinPath(directory, `${temporaryName(options?.prefix)}${options?.suffix ?? ""}`);
      yield* writeFileAt(file, new Uint8Array());
      return file;
    });

  const fileSystem = FileSystem.make({
    access,
    chmod: () => unimplementedEffect("chmod"),
    chown: () => unimplementedEffect("chown"),
    copy: () => unimplementedEffect("copy"),
    copyFile: (fromPath, toPath) =>
      attempt("copyFile", normalisePath(fromPath), () =>
        copyFile(normalisePath(fromPath), normalisePath(toPath)),
      ),
    glob: () => unimplementedEffect("glob"),
    link: () => unimplementedEffect("link"),
    makeDirectory: (path, options) =>
      attempt("makeDirectory", normalisePath(path), () =>
        mkdir(normalisePath(path), { recursive: options?.recursive ?? false }),
      ),
    makeTempDirectory,
    makeTempDirectoryScoped: (options) =>
      Effect.acquireRelease(makeTempDirectory(options), removeQuietly),
    makeTempFile,
    makeTempFileScoped: (options) => Effect.acquireRelease(makeTempFile(options), removeQuietly),
    open: () => unimplementedEffect("open"),
    readDirectory,
    readFile: (path) =>
      attempt("readFile", normalisePath(path), () => readFile(normalisePath(path))),
    readLink: () => unimplementedEffect("readLink"),
    realPath: (path) => Effect.as(access(path), normalisePath(path)),
    remove: (path, options) =>
      Effect.suspend(() => {
        const resolved = normalisePath(path);
        const removal = attempt("remove", resolved, () =>
          remove(resolved, { recursive: options?.recursive ?? false }),
        );
        // `force` means "absent is fine", and only that: every other failure
        // still surfaces. Asking first is clearer than classifying the
        // plugin's rejection text a second time.
        if (options?.force !== true) return removal;
        return Effect.flatMap(
          attempt("remove", resolved, () => exists(resolved)),
          (present) => (present ? removal : Effect.void),
        );
      }),
    // Replaces the destination, which is the property `writeFileAtomic`
    // depends on. The fs plugin's rename is the OS rename.
    rename: (oldPath, newPath) =>
      attempt("rename", normalisePath(oldPath), () =>
        rename(normalisePath(oldPath), normalisePath(newPath)),
      ),
    stat: (path) =>
      Effect.map(
        attempt("stat", normalisePath(path), () => stat(normalisePath(path))),
        infoOf,
      ),
    symlink: () => unimplementedEffect("symlink"),
    truncate: () => unimplementedEffect("truncate"),
    utimes: () => unimplementedEffect("utimes"),
    /**
     * A real watcher. `watch` is scoped: the stream's scope owns the plugin's
     * unwatch function, so a project that closes stops listening — a leaked
     * watcher on a directory the user deleted is a real source of phantom
     * "external change" notices.
     */
    watch: (path, options) =>
      Stream.callback<FileSystem.WatchEvent, PlatformError.PlatformError>((queue) =>
        Effect.acquireRelease(
          Effect.tryPromise({
            try: () =>
              watch(
                normalisePath(path),
                (event) => {
                  for (const emitted of watchEventsOf(event)) {
                    Queue.offerUnsafe(queue, emitted);
                  }
                },
                { recursive: options?.recursive ?? false },
              ),
            catch: (cause) => {
              const message = messageOf(cause);
              return systemError(classify(message), "watch", normalisePath(path), message, cause);
            },
          }),
          (unwatch) => Effect.sync(unwatch),
        ),
      ),
    writeFile: writeFileAt,
  });

  return fileSystem;
};

export const TauriFileSystemLive: Layer.Layer<FileSystem.FileSystem> = Layer.sync(
  FileSystem.FileSystem,
  makeTauriFileSystem,
);
